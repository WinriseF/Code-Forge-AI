use serde::{Deserialize, Serialize};

// 来自 git.rs
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitCommit {
    pub hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitDiffFile {
    pub path: String,
    pub status: String,
    pub old_path: Option<String>,
    pub original_content: String,
    pub modified_content: String,
    pub is_binary: bool,
    pub is_large: bool,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct GitDiffSummary {
    pub files_changed: usize,
    pub files_added: usize,
    pub files_modified: usize,
    pub files_deleted: usize,
    pub files_renamed: usize,
    pub insertions: usize,
    pub deletions: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitDiffResponse {
    pub files: Vec<GitDiffFile>,
    pub summary: GitDiffSummary,
}

// --- Git Graph Types ---

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GraphCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
    pub parent_hashes: Vec<String>,
    pub refs: Vec<GitRef>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitRef {
    pub name: String,
    pub kind: GitRefKind,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum GitRefKind {
    Head,
    Branch,
    RemoteBranch,
    Tag,
    Stash,
    DeletedBranch,
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
