use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};

use crate::config::Config;
use crate::git::repository::GitRepository;
use crate::models::{DiffHunk, DiffResponse, ErrorResponse};
use crate::utils::get_repo_path;

#[derive(serde::Deserialize)]
pub struct DiffQuery {
    path: String,
    #[serde(rename = "ref")]
    ref_: Option<String>,
    staged: Option<String>,
}

pub async fn get_diff(
    State(config): State<Config>,
    Path(repo): Path<String>,
    Query(params): Query<DiffQuery>,
) -> Result<Json<DiffResponse>, (StatusCode, Json<ErrorResponse>)> {
    let repo_path = get_repo_path(&repo, &config.repos_root);
    let file_path = params.path.clone();
    let ref_sha = params.ref_.clone();
    let staged = params.staged.as_deref() == Some("true");

    // Move blocking git operations to a thread pool to avoid blocking the async runtime
    let result = tokio::task::spawn_blocking(move || {
        let git_repo = GitRepository::open(&repo_path)
            .map_err(|e| format!("Failed to open repository: {}", e))?;

        if let Some(ref_sha) = ref_sha {
            // Commit diff: get diff for a file in a specific commit vs its parent
            let file_diff = git_repo
                .get_file_diff(ref_sha.trim(), &file_path)
                .map_err(|e| format!("Failed to get diff: {}", e))?;

            let hunks: Vec<DiffHunk> = file_diff
                .hunks
                .into_iter()
                .enumerate()
                .map(|(i, h)| DiffHunk {
                    old_start: h.old_start,
                    old_count: h.old_count,
                    new_start: h.new_start,
                    new_count: h.new_count,
                    lines: h.lines,
                    line_start: i as i32,
                })
                .collect();

            return Ok(DiffResponse {
                diff: file_diff.diff,
                hunks,
                file_path: file_diff.file_path,
            });
        }

        // Working directory diff (staged or unstaged)
        let file_diff = git_repo
            .get_working_diff(&file_path, staged)
            .map_err(|e| format!("Failed to get working diff: {}", e))?;

        let hunks: Vec<DiffHunk> = file_diff
            .hunks
            .into_iter()
            .enumerate()
            .map(|(i, h)| DiffHunk {
                old_start: h.old_start,
                old_count: h.old_count,
                new_start: h.new_start,
                new_count: h.new_count,
                lines: h.lines,
                line_start: i as i32,
            })
            .collect();

        Ok(DiffResponse {
            diff: file_diff.diff,
            hunks,
            file_path: file_diff.file_path,
        })
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

    result.map(Json).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: e }),
        )
    })
}
