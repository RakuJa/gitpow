use git2;
use gitpow_rust::config::Config;
use gitpow_rust::git::repository::GitRepository;
use gitpow_rust::models::{Commit, CommitMetric, CommitsBetweenResponse, Tag};
use gitpow_rust::utils::{get_repo_path, normalize_sha};
use rayon::prelude::*;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::State;
use anyhow;

#[derive(Deserialize)]
pub struct GetCommitsParams {
    repo: String,
    branch: Option<String>,
    limit: Option<usize>,
    mode: Option<String>,
    main_branch: Option<String>,
}

#[derive(Deserialize)]
pub struct GetCommitsBetweenParams {
    repo: String,
    from: String,
    to: String,
}

#[derive(Deserialize)]
pub struct GetCommitMetricsParams {
    repo: String,
    branch: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
pub struct GetAllBranchesCommitsParams {
    repo: String,
    limit: Option<usize>,
}

fn parse_shortstat(line: &str) -> (i32, i32) {
    // Example: " 2 files changed, 10 insertions(+), 3 deletions(-)"
    let mut files_changed = 0;
    let mut insertions = 0;
    let mut deletions = 0;

    for part in line.split(',') {
        let trimmed = part.trim();
        if let Some(num) = trimmed
            .split_whitespace()
            .next()
            .and_then(|s| s.parse::<i32>().ok())
        {
            if trimmed.contains("file") {
                files_changed = num;
            } else if trimmed.contains("insertion") {
                insertions = num;
            } else if trimmed.contains("deletion") {
                deletions = num;
            }
        }
    }

    (files_changed, insertions + deletions)
}

#[tauri::command]
pub async fn get_commits(
    params: GetCommitsParams,
    config: State<'_, Mutex<Config>>,
) -> Result<Vec<Commit>, String> {
    let repos_root = {
        let config = config.lock().unwrap();
        config.repos_root.clone()
    };
    let repo_path = get_repo_path(&params.repo, &repos_root);
    let branch_name = params.branch.unwrap_or_else(|| "HEAD".to_string());
    let limit = params.limit.unwrap_or(2000);
    let mode = params.mode.unwrap_or_else(|| "full".to_string());

    // Move blocking git operations off the main thread
    tokio::task::spawn_blocking(move || {
        let git_repo = GitRepository::open(&repo_path)
            .map_err(|e| format!("Failed to open repository: {}", e))?;

        // For graph "All branches" mode we pass mode=local so each branch fetch
        // only marks commits with that branch. For other modes, use the fuller
        // branch-head annotations.
        let commits = if mode.eq_ignore_ascii_case("local") {
            git_repo.get_commits_local(&branch_name, limit)
        } else {
            git_repo.get_commits(&branch_name, limit)
        }
        .map_err(|e| format!("Failed to get commits: {}", e))?;

        Ok(commits)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Aggregated all-branches commit history for graph "All" mode.
/// Walks per-branch local histories and merges the results by SHA so the
/// frontend can render per-branch lanes without issuing one HTTP request
/// per branch.
#[tauri::command]
pub async fn get_commits_all_branches(
    params: GetAllBranchesCommitsParams,
    config: State<'_, Mutex<Config>>,
) -> Result<Vec<Commit>, String> {
    let repos_root = {
        let config = config.lock().unwrap();
        config.repos_root.clone()
    };
    let repo_path = get_repo_path(&params.repo, &repos_root);

    // Move all blocking operations to spawn_blocking with rayon parallelization
    let max_total = params.limit.unwrap_or(2000);

    let combined = tokio::task::spawn_blocking(move || {
        let git_repo = GitRepository::open(&repo_path)
            .map_err(|e| anyhow::anyhow!("Failed to open repository: {}", e))?;

        // Discover all local + remote branches
        let branch_info = git_repo
            .get_branch_info()
            .map_err(|e| anyhow::anyhow!("Failed to get branches: {}", e))?;

        let branches = branch_info.branches;
        if branches.is_empty() {
            return Ok(HashMap::new());
        }

        let branch_count = branches.len().max(1);

        // Calculate per-branch limit with minimum to ensure meaningful history
        const MIN_PER_BRANCH: usize = 50;
        let mut per_branch_limit = (max_total / branch_count).max(MIN_PER_BRANCH);
        if per_branch_limit > 500 {
            per_branch_limit = 500;
        }

        // Use a Mutex-protected HashMap for thread-safe accumulation
        // HashSet for branch membership checks (O(1) vs O(N) for Vec::contains)
        let combined: Mutex<HashMap<String, (Commit, HashSet<String>)>> = Mutex::new(HashMap::new());
        let repo_path = git_repo.repo.path().parent().unwrap_or(git_repo.repo.path()).to_path_buf();

        // Process branches in parallel using rayon
        branches.par_iter().try_for_each(|branch| {
            // Each thread opens its own repo connection (libgit2 pattern)
            let git_repo = GitRepository::open(&repo_path)
                .map_err(|e| anyhow::anyhow!("Failed to open repository: {}", e))?;

            let commits_for_branch = git_repo
                .get_commits_local(branch, per_branch_limit)
                .map_err(|e| anyhow::anyhow!("Failed to get commits for branch {}: {}", branch, e))?;

            // Lock and update combined map
            let mut map = combined.lock().unwrap();
            for commit in commits_for_branch {
                let sha = commit.sha.clone();
                let entry = map.entry(sha).or_insert_with(|| (commit, HashSet::new()));
                entry.1.insert(branch.clone());
            }

            Ok::<(), anyhow::Error>(())
        })?;

        // Convert HashSet branches back to Vec
        let combined = combined.into_inner().unwrap();
        let result: HashMap<String, Commit> = combined
            .into_iter()
            .map(|(sha, (mut commit, branch_set))| {
                commit.branches = branch_set.into_iter().collect();
                (sha, commit)
            })
            .collect();

        Ok::<HashMap<String, Commit>, anyhow::Error>(result)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    let combined = combined.map_err(|e| format!("{}", e))?;

    let mut all_commits: Vec<Commit> = combined.into_values().collect();

    // Sort newest-first by date string (RFC3339) which compares lexicographically.
    all_commits.sort_by(|a, b| b.date.cmp(&a.date));

    if all_commits.len() > max_total {
        all_commits.truncate(max_total);
    }

    Ok(all_commits)
}

#[tauri::command]
pub async fn get_commits_between(
    params: GetCommitsBetweenParams,
    config: State<'_, Mutex<Config>>,
) -> Result<CommitsBetweenResponse, String> {
    let repos_root = {
        let config = config.lock().unwrap();
        config.repos_root.clone()
    };
    let repo_path = get_repo_path(&params.repo, &repos_root);
    let from_sha = normalize_sha(&params.from);
    let to_sha = normalize_sha(&params.to);

    tokio::task::spawn_blocking(move || {
        let git_repo = GitRepository::open(&repo_path)
            .map_err(|e| format!("Failed to open repository: {}", e))?;

        if git_repo.is_ancestor(&to_sha, &from_sha).unwrap_or(false) {
            let count = git_repo
                .count_commits_between(&from_sha, &to_sha)
                .unwrap_or(0);
            return Ok(CommitsBetweenResponse {
                count: count as i32,
                note: None,
                from: Some(from_sha),
                to: Some(to_sha),
                error: None,
            });
        }

        if git_repo.is_ancestor(&from_sha, &to_sha).unwrap_or(false) {
            return Ok(CommitsBetweenResponse {
                count: 0,
                note: Some("Creation commit is after current commit".to_string()),
                from: Some(from_sha),
                to: Some(to_sha),
                error: None,
            });
        }

        Ok(CommitsBetweenResponse {
            count: -1,
            note: Some("Could not find common ancestor".to_string()),
            from: Some(from_sha),
            to: Some(to_sha),
            error: None,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn get_commit_metrics(
    params: GetCommitMetricsParams,
    config: State<'_, Mutex<Config>>,
) -> Result<Vec<CommitMetric>, String> {
    let repos_root = {
        let config = config.lock().unwrap();
        config.repos_root.clone()
    };
    let repo_path = get_repo_path(&params.repo, &repos_root);
    let branch_name = params.branch.unwrap_or_else(|| "HEAD".to_string());
    let limit = params.limit.unwrap_or(100);

    tokio::task::spawn_blocking(move || {
        let git_repo = GitRepository::open(&repo_path)
            .map_err(|e| format!("Failed to open repository: {}", e))?;

        // Use libgit2 revwalk to get commit SHAs
        let target = git_repo.repo.revparse_single(&branch_name)
            .map_err(|e| format!("Failed to resolve branch '{}': {}", branch_name, e))?;

        let mut revwalk = git_repo.repo.revwalk()
            .map_err(|e| format!("Failed to create revwalk: {}", e))?;

        revwalk.push(target.id())
            .map_err(|e| format!("Failed to start revwalk: {}", e))?;

        revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
            .map_err(|e| format!("Failed to set revwalk sorting: {}", e))?;

        // Collect commit OIDs first
        let oids: Vec<git2::Oid> = revwalk
            .take(limit)
            .filter_map(|r| r.ok())
            .collect();

        // Parallelize metric calculation using rayon
        let repo_path_for_threads = git_repo.repo.path().parent()
            .unwrap_or(git_repo.repo.path()).to_path_buf();

        let metrics: Vec<CommitMetric> = oids
            .par_iter()
            .filter_map(|oid| {
                // Each thread opens its own repo connection
                let git_repo = GitRepository::open(&repo_path_for_threads).ok()?;
                let (files_changed, lines_changed) = git_repo.get_commit_stats(*oid).unwrap_or((0, 0));

                let impact_score = (lines_changed as f64 * 0.7 + files_changed as f64 * 10.0 * 0.3)
                    * (lines_changed as f64 * 0.7 + files_changed as f64 * 10.0 * 0.3);

                Some(CommitMetric {
                    sha: oid.to_string(),
                    lines_changed,
                    files_changed,
                    impact_score,
                })
            })
            .collect();

        Ok(metrics)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn get_tags(
    repo: String,
    config: State<'_, Mutex<Config>>,
) -> Result<Vec<Tag>, String> {
    let repos_root = {
        let config = config.lock().unwrap();
        config.repos_root.clone()
    };
    let repo_path = get_repo_path(&repo, &repos_root);

    tokio::task::spawn_blocking(move || {
        let git_repo = GitRepository::open(&repo_path)
            .map_err(|e| format!("Failed to open repository: {}", e))?;

        let tags_out = git_repo.run_git(&[
            "for-each-ref",
            "refs/tags",
            "--format=%(refname:short)%00%(objectname)%00%(creatordate:iso-strict)",
        ]);

        let mut tags = Vec::new();
        if let Ok(output) = tags_out {
            for line in output.lines() {
                let parts: Vec<&str> = line.split('\0').collect();
                if parts.len() >= 3 {
                    tags.push(Tag {
                        name: parts[0].to_string(),
                        sha: parts[1].to_string(),
                        date: parts[2].to_string(),
                    });
                }
            }
        }

        Ok(tags)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}


