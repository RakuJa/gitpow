use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use serde::Deserialize;
use std::fs;

use crate::config::Config;
use crate::git::repository::run_git;
use crate::models::{
    ConflictFile, ConflictFileResponse, ConflictsResponse, ErrorResponse, ResolveConflictRequest,
    SuccessResponse,
};
use crate::utils::get_repo_path;

#[derive(Deserialize)]
pub struct ConflictFileQuery {
    path: String,
}

pub async fn get_conflicts(
    State(config): State<Config>,
    Path(repo): Path<String>,
) -> Result<Json<ConflictsResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = get_repo_path(&repo, &config.repos_root);

    let status_out = run_git(&["status", "--porcelain"], &repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to get status: {}", e),
            }),
        )
    })?;

    let lines: Vec<&str> = status_out.split('\n').collect();
    let mut conflicted_files = Vec::new();

    for line in lines {
        let line = line.trim();
        if line.len() < 3 {
            continue;
        }

        let status1 = line.chars().next().unwrap_or(' ');
        let status2 = line.chars().nth(1).unwrap_or(' ');

        let is_conflict = (status1 == 'A' && status2 == 'A')
            || status1 == 'U'
            || status2 == 'U'
            || (status1 == 'D' && status2 == 'D')
            || (status1 == 'A' && status2 == 'U')
            || (status1 == 'U' && status2 == 'A')
            || (status1 == 'D' && status2 == 'U')
            || (status1 == 'U' && status2 == 'D');

        if is_conflict {
            let file_path = &line[3..];
            if file_path.contains(" -> ") {
                let parts: Vec<&str> = file_path.split(" -> ").collect();
                if parts.len() == 2 {
                    conflicted_files.push(ConflictFile {
                        path: parts[1].to_string(),
                        r#type: "both-modified".to_string(),
                    });
                }
            } else {
                conflicted_files.push(ConflictFile {
                    path: file_path.to_string(),
                    r#type: "both-modified".to_string(),
                });
            }
        }
    }

    Ok(Json(ConflictsResponse {
        files: conflicted_files.clone(),
        has_conflicts: !conflicted_files.is_empty(),
    }))
}

pub async fn get_conflict_file(
    State(config): State<Config>,
    Path(repo): Path<String>,
    Query(params): Query<ConflictFileQuery>,
) -> Result<Json<ConflictFileResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = get_repo_path(&repo, &config.repos_root);

    // Get Base (common ancestor), Mine (current/ours), and Theirs (incoming)
    // :1: = base, :2: = ours, :3: = theirs
    let base = run_git(&["show", &format!(":1:{}", params.path)], &repo_path).unwrap_or_default();

    let mine =
        run_git(&["show", &format!(":2:{}", params.path)], &repo_path).unwrap_or_else(|_| {
            // Fallback to working tree
            let full_path = repo_path.join(&params.path);
            fs::read_to_string(&full_path).unwrap_or_default()
        });

    let theirs = run_git(&["show", &format!(":3:{}", params.path)], &repo_path).unwrap_or_default();

    // Get current conflicted content (working tree)
    let full_path = repo_path.join(&params.path);
    let result = fs::read_to_string(&full_path).unwrap_or_default();

    Ok(Json(ConflictFileResponse {
        base,
        mine,
        theirs,
        result,
        file_path: params.path,
    }))
}

pub async fn resolve_conflict(
    State(config): State<Config>,
    Path(repo): Path<String>,
    Json(req): Json<ResolveConflictRequest>,
) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = get_repo_path(&repo, &config.repos_root);

    if req.path.is_empty() || req.content.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "path and content required".to_string(),
            }),
        ));
    }

    // Write resolved content to file
    let full_path = repo_path.join(&req.path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Failed to create directory: {}", e),
                }),
            )
        })?;
    }

    fs::write(&full_path, req.content).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to write file: {}", e),
            }),
        )
    })?;

    // Stage the resolved file
    run_git(&["add", &req.path], &repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to stage file: {}", e),
            }),
        )
    })?;

    Ok(Json(SuccessResponse { success: true }))
}
