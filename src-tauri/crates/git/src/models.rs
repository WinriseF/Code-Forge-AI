use serde::{Deserialize, Serialize};

// 来自 git.rs
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRef {
    pub name: String,
    pub ref_type: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
    pub parent_hashes: Vec<String>,
    pub refs: Vec<GitCommitRef>,
    pub files_changed: usize,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositorySummary {
    pub repository_name: String,
    pub branch_name: String,
    pub head_hash: String,
    pub last_commit_message: String,
    pub staged_changes: usize,
    pub unstaged_changes: usize,
    pub untracked_files: usize,
    pub is_dirty: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffFile {
    pub path: String,
    pub status: String,
    pub old_path: Option<String>,
    pub original_content: String,
    pub modified_content: String,
    pub is_binary: bool,
    pub is_large: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitChange {
    pub path: String,
    pub status: String,
    pub old_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetails {
    pub hash: String,
    pub author: String,
    pub email: String,
    pub date: String,
    pub summary: String,
    pub message: String,
    pub parent_hashes: Vec<String>,
    pub changed_files: Vec<GitCommitChange>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchRef {
    pub name: String,
    pub short_name: String,
    pub branch_type: String,
    pub is_current: bool,
    pub upstream_name: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub last_commit_hash: String,
    pub last_commit_date: String,
    pub last_commit_message: String,
}

// 来自 export.rs
#[derive(Deserialize, Clone, Copy, PartialEq)]
pub enum ExportFormat {
    Markdown,
    Json,
    Xml,
    Txt,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
pub enum ExportLayout {
    Split,
    Unified,
    GitPatch,
}
