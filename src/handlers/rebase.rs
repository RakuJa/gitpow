use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use serde::Deserialize;

use crate::config::Config;
use crate::git::repository::run_git;
use crate::models::{
    Commit, ErrorResponse, RebasePlanItem, RebasePlanRequest, RebasePlanResponse, RebasePreview,
};
use crate::utils::{get_repo_path, normalize_sha};

#[derive(Deserialize)]
pub struct RebasePreviewQuery {
    onto: Option<String>,
    from: Option<String>,
}

pub async fn get_rebase_preview(
    State(config): State<Config>,
    Path(repo): Path<String>,
    Query(params): Query<RebasePreviewQuery>,
) -> Result<Json<RebasePreview>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = get_repo_path(&repo, &config.repos_root);

    let onto = params.onto.as_deref().unwrap_or("main");
    let from = params.from.as_deref().unwrap_or("HEAD");

    // Check for uncommitted changes
    let status_out = run_git(&["status", "--porcelain"], &repo_path).unwrap_or_default();
    if !status_out.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Cannot rebase with uncommitted changes. Please commit or stash first."
                    .to_string(),
            }),
        ));
    }

    // Get merge base
    let merge_base = run_git(&["merge-base", from, onto], &repo_path).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Cannot find common ancestor".to_string(),
            }),
        )
    })?;

    let merge_base = normalize_sha(&merge_base.trim());

    // Get commits
    let format = "%H%x1f%an%x1f%ad%x1f%s%x1e";
    let commits_out = run_git(
        &[
            "log",
            &format!("{}..{}", merge_base, from),
            &format!("--format={}", format),
            "--date=iso-strict",
        ],
        &repo_path,
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to get commits: {}", e),
            }),
        )
    })?;

    let chunks: Vec<&str> = commits_out.split('\x1e').collect();
    let mut commits = Vec::new();

    for chunk in chunks {
        let chunk = chunk.trim();
        if chunk.is_empty() {
            continue;
        }
        let parts: Vec<&str> = chunk.split('\x1f').collect();
        if parts.len() < 4 {
            continue;
        }

        let raw_sha = parts[0].trim();
        let sha = normalize_sha(raw_sha);

        commits.push(Commit {
            sha,
            author: parts[1].trim().to_string(),
            email: String::new(),
            date: parts[2].trim().to_string(),
            message: parts[3].trim().to_string(),
            parents: Vec::new(),
            is_merge: false,
            branches: Vec::new(),
            primary_branch: None,
            is_head: None,
            is_main: None,
            branch_angle: None,
            branch_info: None,
            branch_divergence_point: None,
            branch_base: None,
            branch_divergence_age_days: None,
        });
    }

    Ok(Json(RebasePreview {
        commits,
        onto: onto.to_string(),
        from: from.to_string(),
        merge_base,
    }))
}

pub async fn post_rebase_plan(
    State(config): State<Config>,
    Path(repo): Path<String>,
    Json(req): Json<RebasePlanRequest>,
) -> Result<Json<RebasePlanResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = get_repo_path(&repo, &config.repos_root);

    if req.onto.is_empty() || req.plan.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "onto and plan (array) required".to_string(),
            }),
        ));
    }

    // Check for uncommitted changes
    let status_out = run_git(&["status", "--porcelain"], &repo_path).unwrap_or_default();
    if !status_out.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Cannot rebase with uncommitted changes".to_string(),
            }),
        ));
    }

    if req.dry_run.unwrap_or(false) {
        let mut result = Vec::new();
        for item in req.plan {
            let action = if item.action.is_empty() {
                "pick".to_string()
            } else {
                item.action
            };
            result.push(RebasePlanItem {
                sha: item.sha,
                action,
                message: item.message,
            });
        }
        return Ok(Json(RebasePlanResponse {
            success: true,
            dry_run: Some(true),
            plan: Some(result),
            error: None,
        }));
    }

    // For actual rebase, return error suggesting manual rebase
    Ok(Json(RebasePlanResponse {
        success: false,
        dry_run: None,
        plan: None,
        error: Some(
            "Interactive rebase execution requires additional setup. Use preview mode to plan your rebase.".to_string(),
        ),
    }))
}
