use std::env;
use std::path::PathBuf;

#[derive(Clone)]
pub struct Config {
    pub repos_root: PathBuf,
    pub port: String,
}

impl Config {
    pub fn init() -> Self {
        let repos_root = env::var("REPOS_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                // Default to the current working directory rather than a hard-coded path
                env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
            });

        let repos_root = repos_root.canonicalize().unwrap_or_else(|_| repos_root);

        let port = env::var("PORT").unwrap_or_else(|_| "3000".to_string());

        Self { repos_root, port }
    }
}
