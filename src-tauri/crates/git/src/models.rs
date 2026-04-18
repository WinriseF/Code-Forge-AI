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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum GitRefKind {
    Head,
    Branch,
    RemoteBranch,
    Tag,
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
