use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use rayon::prelude::*;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use crate::config::Config;
use crate::git::repository::GitRepository;
use crate::models::{Commit, CommitMetric, CommitsBetweenResponse, ErrorResponse, Tag};
use crate::utils::{get_repo_path, normalize_sha};
use anyhow;

#[derive(Deserialize)]
pub struct CommitsQuery {
    branch: Option<String>,
    limit: Option<usize>,
    mode: Option<String>,
}

#[derive(Deserialize)]
pub struct CommitsBetweenQuery {
    from: String,
    to: String,
}

#[derive(Deserialize)]
pub struct CommitMetricsQuery {
    branch: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
pub struct AllBranchesCommitsQuery {
    limit: Option<usize>,
}

pub async fn get_commits(
    State(config): State<Config>,
    Path(repo): Path<String>,
    Query(params): Query<CommitsQuery>,
) -> Result<Json<Vec<Commit>>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = get_repo_path(&repo, &config.repos_root);
    let branch_name = params.branch.as_deref().unwrap_or("HEAD").to_string();
    let limit = params.limit.unwrap_or(2000);
    let mode = params.mode.as_deref().unwrap_or("full").to_string();

    // Move blocking git operations to a thread pool to avoid blocking the async runtime
    let commits = tokio::task::spawn_blocking(move || {
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

        Ok::<Vec<Commit>, String>(commits)
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Task join error: {}", e),
            }),
        )
    })?
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: e }),
        )
    })?;

    Ok(Json(commits))
}

/// Aggregated all-branches commit history for graph \"All\" mode.
/// Walks per-branch local histories and merges the results by SHA so the
/// frontend can render per-branch lanes without issuing one HTTP request
/// per branch.
pub async fn get_commits_all_branches(
    State(config): State<Config>,
    Path(repo): Path<String>,
    Query(params): Query<AllBranchesCommitsQuery>,
) -> Result<Json<Vec<Commit>>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = get_repo_path(&repo, &config.repos_root);
    let git_repo = GitRepository::open(&repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to open repository: {}", e),
            }),
        )
    })?;

    // Discover all local + remote branches so the aggregation matches what the
    // branch picker shows in the frontend.
    let branch_info = git_repo.get_branch_info().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to get branches: {}", e),
            }),
        )
    })?;

    let branches = branch_info.branches;
    if branches.is_empty() {
        return Ok(Json(Vec::new()));
    }

    let max_total = params.limit.unwrap_or(2000);
    let branch_count = branches.len().max(1);

    // Calculate per-branch limit with a minimum to ensure meaningful history.
    // Without a minimum, repos with many branches (e.g., 300) would only get
    // ~6 commits per branch (2000/300), and after SHA deduplication across
    // branches that share commits, you could end up with very few unique commits.
    // The final truncation to max_total keeps the result bounded.
    const MIN_PER_BRANCH: usize = 50;
    let mut per_branch_limit = (max_total / branch_count).max(MIN_PER_BRANCH);

    // Keep per-branch limits reasonable so very large repos don't explode.
    if per_branch_limit > 500 {
        per_branch_limit = 500;
    }

    // Move commit fetching to a blocking thread pool with parallel branch processing
    // Each rayon thread opens its own repo connection (libgit2 pattern)
    let repo_path_clone = repo_path.clone();
    let combined = tokio::task::spawn_blocking(move || {
        // Use a Mutex-protected HashMap for thread-safe accumulation
        // HashSet for branch membership checks (O(1) vs O(N) for Vec::contains)
        let combined: Mutex<HashMap<String, (Commit, HashSet<String>)>> = Mutex::new(HashMap::new());

        // Process branches in parallel using rayon
        branches.par_iter().try_for_each(|branch| {
            // Each thread opens its own repo connection
            let git_repo = GitRepository::open(&repo_path_clone)
                .map_err(|e| anyhow::anyhow!("Failed to open repository: {}", e))?;

            let commits_for_branch = git_repo
                .get_commits_local(branch, per_branch_limit)
                .map_err(|e| anyhow::anyhow!("Failed to get commits for branch {}: {}", branch, e))?;

            // Lock and update combined map
            let mut map = combined.lock().unwrap();
            for commit in commits_for_branch {
                let sha = commit.sha.clone();
                let entry = map.entry(sha).or_insert_with(|| {
                    (commit, HashSet::new())
                });
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
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Task join error: {}", e),
            }),
        )
    })?;

    let combined = combined.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("{}", e),
            }),
        )
    })?;

    let mut all_commits: Vec<Commit> = combined.into_values().collect();

    // Sort newest-first by date string (RFC3339) which compares lexicographically.
    all_commits.sort_by(|a, b| b.date.cmp(&a.date));

    if all_commits.len() > max_total {
        all_commits.truncate(max_total);
    }

    Ok(Json(all_commits))
}

pub async fn get_commits_between(
    State(config): State<Config>,
    Path(repo): Path<String>,
    Query(params): Query<CommitsBetweenQuery>,
) -> Result<Json<CommitsBetweenResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = get_repo_path(&repo, &config.repos_root);
    let git_repo = GitRepository::open(&repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to open repository: {}", e),
            }),
        )
    })?;

    let from_sha = normalize_sha(&params.from);
    let to_sha = normalize_sha(&params.to);

    if git_repo.is_ancestor(&to_sha, &from_sha).unwrap_or(false) {
        let count = git_repo
            .count_commits_between(&from_sha, &to_sha)
            .unwrap_or(0);
        return Ok(Json(CommitsBetweenResponse {
            count: count as i32,
            note: None,
            from: Some(from_sha),
            to: Some(to_sha),
            error: None,
        }));
    }

    if git_repo.is_ancestor(&from_sha, &to_sha).unwrap_or(false) {
        return Ok(Json(CommitsBetweenResponse {
            count: 0,
            note: Some("Creation commit is after current commit".to_string()),
            from: Some(from_sha),
            to: Some(to_sha),
            error: None,
        }));
    }

    Ok(Json(CommitsBetweenResponse {
        count: -1,
        note: Some("Could not find common ancestor".to_string()),
        from: Some(from_sha),
        to: Some(to_sha),
        error: None,
    }))
}

pub async fn get_commit_metrics(
    State(config): State<Config>,
    Path(repo): Path<String>,
    Query(params): Query<CommitMetricsQuery>,
) -> Result<Json<Vec<CommitMetric>>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = get_repo_path(&repo, &config.repos_root);
    let git_repo = GitRepository::open(&repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to open repository: {}", e),
            }),
        )
    })?;

    let branch_name = params.branch.as_deref().unwrap_or("HEAD");
    let limit = params.limit.unwrap_or(100);

    // Use libgit2 revwalk instead of spawning git log
    let target = git_repo.repo.revparse_single(branch_name).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to resolve branch '{}': {}", branch_name, e),
            }),
        )
    })?;

    let mut revwalk = git_repo.repo.revwalk().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to create revwalk: {}", e),
            }),
        )
    })?;

    revwalk.push(target.id()).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to start revwalk: {}", e),
            }),
        )
    })?;

    revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Failed to set revwalk sorting: {}", e),
                }),
            )
        })?;

    let mut metrics = Vec::new();
    for oid_result in revwalk.take(limit) {
        let oid = match oid_result {
            Ok(oid) => oid,
            Err(_) => continue,
        };

        // Use libgit2-based stats instead of spawning git show
        let (files_changed, lines_changed) = git_repo
            .get_commit_stats(oid)
            .unwrap_or((0, 0));

        let impact_score = (lines_changed as f64 * 0.7 + files_changed as f64 * 10.0 * 0.3)
            * (lines_changed as f64 * 0.7 + files_changed as f64 * 10.0 * 0.3);

        metrics.push(CommitMetric {
            sha: oid.to_string(),
            lines_changed,
            files_changed,
            impact_score,
        });
    }

    Ok(Json(metrics))
}

pub async fn get_tags(
    State(config): State<Config>,
    Path(repo): Path<String>,
) -> Result<Json<Vec<Tag>>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = get_repo_path(&repo, &config.repos_root);
    let git_repo = GitRepository::open(&repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to open repository: {}", e),
            }),
        )
    })?;

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

    Ok(Json(tags))
}
