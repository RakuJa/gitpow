use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BranchMetadata {
    pub is_merged: bool,
    pub is_stale: bool,
    pub is_unborn: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_commit_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub current: String,
    pub branches: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_metadata: Option<std::collections::HashMap<String, BranchMetadata>>,
    /// HEAD commit SHA for cache invalidation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    /// Hash of all branch refs for cache invalidation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refs_hash: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchAheadBehind {
    pub ahead: i32,
    pub behind: i32,
    pub upstream: String,
    pub is_local: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCreationInfo {
    pub found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_root_commit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub sha: String,
    pub author: String,
    pub email: String,
    pub date: String,
    pub message: String,
    pub parents: Vec<String>,
    pub is_merge: bool,
    pub branches: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_head: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_main: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_angle: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_info: Option<BranchInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_divergence_point: Option<String>, // SHA of commit where branch diverged
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_base: Option<String>, // Base branch name (main, develop, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_divergence_age_days: Option<f64>, // Days since divergence
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchHierarchy {
    pub name: String,
    pub angle: f64,
    pub first_commit: String,
    pub last_commit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_branch: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitsResponse {
    pub commits: Vec<Commit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_hierarchy: Option<Vec<BranchHierarchy>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_angles: Option<std::collections::HashMap<String, f64>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub status: String, // added, modified, removed
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: i32,
    pub old_count: i32,
    pub new_start: i32,
    pub new_count: i32,
    pub lines: Vec<String>,
    pub line_start: i32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResponse {
    pub diff: String,
    pub hunks: Vec<DiffHunk>,
    pub file_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub r#type: String, // modified, added, deleted, untracked, renamed
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusResponse {
    pub files: Vec<StatusFile>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileCreationInfo {
    pub found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitsBetweenResponse {
    pub count: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageResponse {
    pub data: String,
    pub mime_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub name: String,
    pub sha: String,
    pub date: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitMetric {
    pub sha: String,
    pub lines_changed: i32,
    pub files_changed: i32,
    pub impact_score: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebasePreview {
    pub commits: Vec<Commit>,
    pub onto: String,
    pub from: String,
    pub merge_base: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebasePlanItem {
    pub sha: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebasePlanRequest {
    pub onto: String,
    pub plan: Vec<RebasePlanItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dry_run: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebasePlanResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dry_run: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<Vec<RebasePlanItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub path: String,
    pub r#type: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictsResponse {
    pub files: Vec<ConflictFile>,
    pub has_conflicts: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFileResponse {
    pub base: String,
    pub mine: String,
    pub theirs: String,
    pub result: String,
    pub file_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveConflictRequest {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuccessResponse {
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigResponse {
    pub repos_root: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseFolderResponse {
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub index: String,
    pub message: String,
    pub date: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchStatusResponse {
    pub branch: String,
    pub has_upstream: bool,
    pub ahead: usize,
    pub behind: usize,
    pub has_uncommitted: bool,
    pub stash_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashListResponse {
    pub entries: Vec<StashEntry>,
}
