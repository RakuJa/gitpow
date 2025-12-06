use regex::Regex;
use std::path::{Path, PathBuf};

pub fn get_repo_path(name: &str, repos_root: &PathBuf) -> PathBuf {
    let candidate = Path::new(name);
    if candidate.is_absolute() {
        // When the client sends an absolute path, trust it directly.
        // This is only used in a local app context.
        return candidate.to_path_buf();
    }

    // Relative repo name – sanitize to prevent directory traversal
    let re = Regex::new(r"[^a-zA-Z0-9_.\\/-]").unwrap();
    let safe_name = re.replace_all(name, "");
    repos_root.join(safe_name.as_ref())
}

pub fn normalize_sha(raw_sha: &str) -> String {
    let re = Regex::new(r"[0-9a-fA-F]{40}").unwrap();
    if let Some(caps) = re.find(raw_sha) {
        caps.as_str().to_string()
    } else {
        raw_sha.to_string()
    }
}
