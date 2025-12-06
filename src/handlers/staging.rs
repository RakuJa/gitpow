use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use serde::Deserialize;
use std::fs;

use crate::config::Config;
use crate::git::repository::run_git;
use crate::models::{ErrorResponse, StatusFile, StatusResponse, SuccessResponse};
use crate::utils::get_repo_path;

#[derive(Deserialize)]
pub struct StageRequest {
    path: String,
    hunks: Option<Vec<usize>>,
}

#[derive(Deserialize)]
pub struct UnstageRequest {
    path: String,
}

#[derive(Deserialize)]
pub struct CommitRequest {
    message: String,
}

pub async fn get_status(
    State(config): State<Config>,
    Path(repo): Path<String>,
) -> Result<Json<StatusResponse>, (StatusCode, Json<ErrorResponse>)> {
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
    let mut files = Vec::new();

    for line in lines {
        // Don't trim leading spaces - they're significant in git status --porcelain format
        // Format: "XY filename" where X=staged status, Y=unstaged status, then space, then filename
        let line = line.trim_end(); // Only trim trailing whitespace
        if line.is_empty() || line.len() < 4 {
            continue;
        }

        let staged = line.chars().next().unwrap() != ' ' && line.chars().next().unwrap() != '?';
        let unstaged = line.chars().nth(1).unwrap() != ' ' && line.chars().nth(1).unwrap() != '?';
        let status = &line[..2];
        // Git status format is always: 2 status chars, then space, then filename
        // Find the space after the 2-char status and get everything after it
        let file_path = if line.len() >= 3 && line.chars().nth(2) == Some(' ') {
            // Standard format: "XY filename" - filename starts at index 3
            &line[3..]
        } else if line.len() > 2 {
            // Fallback: skip first 3 chars (should be "XY " but handle edge cases)
            &line[3..]
        } else {
            continue;
        };

        if file_path.contains(" -> ") {
            // Renamed file
            let parts: Vec<&str> = file_path.split(" -> ").collect();
            if parts.len() == 2 {
                files.push(StatusFile {
                    path: parts[1].to_string(),
                    old_path: Some(parts[0].to_string()),
                    status: status.to_string(),
                    staged,
                    unstaged,
                    r#type: "renamed".to_string(),
                });
            }
        } else {
            let file_type = if status.contains('A') {
                "added"
            } else if status.contains('D') {
                "deleted"
            } else if status.contains('?') {
                "untracked"
            } else {
                "modified"
            };

            files.push(StatusFile {
                path: file_path.to_string(),
                old_path: None,
                status: status.to_string(),
                staged,
                unstaged,
                r#type: file_type.to_string(),
            });
        }
    }

    Ok(Json(StatusResponse { files }))
}

pub async fn stage(
    State(config): State<Config>,
    Path(repo): Path<String>,
    Json(req): Json<StageRequest>,
) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = get_repo_path(&repo, &config.repos_root);

    if let Some(hunks) = req.hunks {
        if !hunks.is_empty() {
            // Stage specific hunks
            let diff_out = run_git(&["diff", "--", &req.path], &repo_path).unwrap_or_default();
            let lines: Vec<&str> = diff_out.split('\n').collect();
            let mut patch_lines = Vec::new();
            let mut in_hunk = false;
            let mut hunk_index = 0;

            for line in lines {
                if line.starts_with("@@") {
                    in_hunk = hunks.contains(&hunk_index);
                    hunk_index += 1;
                    if in_hunk {
                        patch_lines.push(line);
                    }
                } else if in_hunk {
                    patch_lines.push(line);
                }
            }

            if !patch_lines.is_empty() {
                let patch_content = patch_lines.join("\n") + "\n";
                let tmp_file = repo_path.join(".git").join("tmp-patch-temp");
                if let Some(parent) = tmp_file.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                fs::write(&tmp_file, patch_content).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            error: format!("Failed to write patch: {}", e),
                        }),
                    )
                })?;

                run_git(
                    &["apply", "--cached", tmp_file.to_str().unwrap()],
                    &repo_path,
                )
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            error: format!("Failed to apply patch: {}", e),
                        }),
                    )
                })?;

                let _ = fs::remove_file(&tmp_file);
            }
        }
    } else {
        // Stage entire file
        run_git(&["add", &req.path], &repo_path).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Failed to stage file: {}", e),
                }),
            )
        })?;
    }

    Ok(Json(SuccessResponse { success: true }))
}

pub async fn unstage(
    State(config): State<Config>,
    Path(repo): Path<String>,
    Json(req): Json<UnstageRequest>,
) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = get_repo_path(&repo, &config.repos_root);

    run_git(&["reset", "HEAD", "--", &req.path], &repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to unstage file: {}", e),
            }),
        )
    })?;

    Ok(Json(SuccessResponse { success: true }))
}

pub async fn commit(
    State(config): State<Config>,
    Path(repo): Path<String>,
    Json(req): Json<CommitRequest>,
) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = get_repo_path(&repo, &config.repos_root);

    let message = req.message.trim();
    if message.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "commit message required".to_string(),
            }),
        ));
    }

    run_git(&["commit", "-m", message], &repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to create commit: {}", e),
            }),
        )
    })?;

    Ok(Json(SuccessResponse { success: true }))
}
