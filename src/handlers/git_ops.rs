use crate::config::Config;
use crate::git::repository::GitRepository;
use crate::models::{
    BranchStatusResponse, ErrorResponse, GitOperationResponse, StashListResponse,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Deserialize)]
pub struct StashPushQuery {
    message: Option<String>,
}

#[derive(Deserialize)]
pub struct StashRefQuery {
    #[serde(rename = "ref")]
    stash_ref: Option<String>,
}

/// Get the current branch status including ahead/behind counts and stash info
pub async fn get_branch_status(
    State(config): State<Config>,
    Path(repo_name): Path<String>,
) -> Result<Json<BranchStatusResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = PathBuf::from(&config.repos_root).join(&repo_name);

    if !repo_path.exists() || !repo_path.is_dir() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Repository not found".to_string(),
            }),
        ));
    }

    let git_repo = GitRepository::open(&repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to open repository: {}", e),
            }),
        )
    })?;

    let branch = git_repo.get_current_branch().unwrap_or_else(|_| "HEAD".to_string());
    let has_upstream = git_repo.has_upstream().unwrap_or(false);
    let (ahead, behind) = if has_upstream {
        git_repo.get_ahead_behind_upstream().unwrap_or((0, 0))
    } else {
        (0, 0)
    };
    let has_uncommitted = git_repo.has_uncommitted_changes().unwrap_or(false);
    let stash_count = git_repo.stash_list().map(|l| l.len()).unwrap_or(0);

    Ok(Json(BranchStatusResponse {
        branch,
        has_upstream,
        ahead,
        behind,
        has_uncommitted,
        stash_count,
    }))
}

/// Pull changes from remote
pub async fn pull_repo(
    State(config): State<Config>,
    Path(repo_name): Path<String>,
) -> Result<Json<GitOperationResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = PathBuf::from(&config.repos_root).join(&repo_name);

    if !repo_path.exists() || !repo_path.is_dir() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Repository not found".to_string(),
            }),
        ));
    }

    let git_repo = GitRepository::open(&repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to open repository: {}", e),
            }),
        )
    })?;

    // Check if there's an upstream configured
    if !git_repo.has_upstream().unwrap_or(false) {
        return Ok(Json(GitOperationResponse {
            success: false,
            message: Some("No upstream branch configured".to_string()),
            output: None,
            error: Some("No upstream branch configured. Push first or set upstream manually.".to_string()),
        }));
    }

    match git_repo.pull() {
        Ok(output) => Ok(Json(GitOperationResponse {
            success: true,
            message: Some("Pull successful".to_string()),
            output: Some(output),
            error: None,
        })),
        Err(e) => Ok(Json(GitOperationResponse {
            success: false,
            message: None,
            output: None,
            error: Some(e.to_string()),
        })),
    }
}

/// Push changes to remote
pub async fn push_repo(
    State(config): State<Config>,
    Path(repo_name): Path<String>,
) -> Result<Json<GitOperationResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = PathBuf::from(&config.repos_root).join(&repo_name);

    if !repo_path.exists() || !repo_path.is_dir() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Repository not found".to_string(),
            }),
        ));
    }

    let git_repo = GitRepository::open(&repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to open repository: {}", e),
            }),
        )
    })?;

    // Check if there's an upstream configured
    let has_upstream = git_repo.has_upstream().unwrap_or(false);

    if has_upstream {
        match git_repo.push() {
            Ok(output) => Ok(Json(GitOperationResponse {
                success: true,
                message: Some("Push successful".to_string()),
                output: Some(output),
                error: None,
            })),
            Err(e) => Ok(Json(GitOperationResponse {
                success: false,
                message: None,
                output: None,
                error: Some(e.to_string()),
            })),
        }
    } else {
        // Try to push with upstream tracking
        let branch = git_repo.get_current_branch().unwrap_or_else(|_| "HEAD".to_string());
        match git_repo.push_set_upstream(&branch) {
            Ok(output) => Ok(Json(GitOperationResponse {
                success: true,
                message: Some(format!("Pushed and set upstream for branch '{}'", branch)),
                output: Some(output),
                error: None,
            })),
            Err(e) => Ok(Json(GitOperationResponse {
                success: false,
                message: None,
                output: None,
                error: Some(e.to_string()),
            })),
        }
    }
}

/// List all stashes
pub async fn stash_list(
    State(config): State<Config>,
    Path(repo_name): Path<String>,
) -> Result<Json<StashListResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = PathBuf::from(&config.repos_root).join(&repo_name);

    if !repo_path.exists() || !repo_path.is_dir() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Repository not found".to_string(),
            }),
        ));
    }

    let git_repo = GitRepository::open(&repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to open repository: {}", e),
            }),
        )
    })?;

    let entries = git_repo.stash_list().unwrap_or_else(|_| Vec::new());

    Ok(Json(StashListResponse { entries }))
}

/// Push changes to stash
pub async fn stash_push(
    State(config): State<Config>,
    Path(repo_name): Path<String>,
    Query(params): Query<StashPushQuery>,
) -> Result<Json<GitOperationResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = PathBuf::from(&config.repos_root).join(&repo_name);

    if !repo_path.exists() || !repo_path.is_dir() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Repository not found".to_string(),
            }),
        ));
    }

    let git_repo = GitRepository::open(&repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to open repository: {}", e),
            }),
        )
    })?;

    // Check if there are changes to stash
    if !git_repo.has_uncommitted_changes().unwrap_or(false) {
        return Ok(Json(GitOperationResponse {
            success: false,
            message: Some("No local changes to stash".to_string()),
            output: None,
            error: None,
        }));
    }

    match git_repo.stash_push(params.message.as_deref()) {
        Ok(output) => Ok(Json(GitOperationResponse {
            success: true,
            message: Some("Changes stashed".to_string()),
            output: Some(output),
            error: None,
        })),
        Err(e) => Ok(Json(GitOperationResponse {
            success: false,
            message: None,
            output: None,
            error: Some(e.to_string()),
        })),
    }
}

/// Pop the most recent stash
pub async fn stash_pop(
    State(config): State<Config>,
    Path(repo_name): Path<String>,
) -> Result<Json<GitOperationResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = PathBuf::from(&config.repos_root).join(&repo_name);

    if !repo_path.exists() || !repo_path.is_dir() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Repository not found".to_string(),
            }),
        ));
    }

    let git_repo = GitRepository::open(&repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to open repository: {}", e),
            }),
        )
    })?;

    // Check if there are stashes to pop
    let stashes = git_repo.stash_list().unwrap_or_else(|_| Vec::new());
    if stashes.is_empty() {
        return Ok(Json(GitOperationResponse {
            success: false,
            message: Some("No stashes to pop".to_string()),
            output: None,
            error: None,
        }));
    }

    match git_repo.stash_pop() {
        Ok(output) => Ok(Json(GitOperationResponse {
            success: true,
            message: Some("Stash popped".to_string()),
            output: Some(output),
            error: None,
        })),
        Err(e) => Ok(Json(GitOperationResponse {
            success: false,
            message: None,
            output: None,
            error: Some(e.to_string()),
        })),
    }
}

/// Apply a specific stash
pub async fn stash_apply(
    State(config): State<Config>,
    Path(repo_name): Path<String>,
    Query(params): Query<StashRefQuery>,
) -> Result<Json<GitOperationResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = PathBuf::from(&config.repos_root).join(&repo_name);

    if !repo_path.exists() || !repo_path.is_dir() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Repository not found".to_string(),
            }),
        ));
    }

    let stash_ref = params.stash_ref.unwrap_or_else(|| "stash@{0}".to_string());

    let git_repo = GitRepository::open(&repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to open repository: {}", e),
            }),
        )
    })?;

    match git_repo.stash_apply(&stash_ref) {
        Ok(output) => Ok(Json(GitOperationResponse {
            success: true,
            message: Some(format!("Stash {} applied", stash_ref)),
            output: Some(output),
            error: None,
        })),
        Err(e) => Ok(Json(GitOperationResponse {
            success: false,
            message: None,
            output: None,
            error: Some(e.to_string()),
        })),
    }
}

/// Drop a specific stash
pub async fn stash_drop(
    State(config): State<Config>,
    Path(repo_name): Path<String>,
    Query(params): Query<StashRefQuery>,
) -> Result<Json<GitOperationResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = PathBuf::from(&config.repos_root).join(&repo_name);

    if !repo_path.exists() || !repo_path.is_dir() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Repository not found".to_string(),
            }),
        ));
    }

    let stash_ref = params.stash_ref.unwrap_or_else(|| "stash@{0}".to_string());

    let git_repo = GitRepository::open(&repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to open repository: {}", e),
            }),
        )
    })?;

    match git_repo.stash_drop(&stash_ref) {
        Ok(output) => Ok(Json(GitOperationResponse {
            success: true,
            message: Some(format!("Stash {} dropped", stash_ref)),
            output: Some(output),
            error: None,
        })),
        Err(e) => Ok(Json(GitOperationResponse {
            success: false,
            message: None,
            output: None,
            error: Some(e.to_string()),
        })),
    }
}
