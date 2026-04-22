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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitRepoOverview {
    pub current_branch: Option<String>,
    pub is_detached_head: bool,
    pub head_hash: Option<String>,
    pub head_short_hash: Option<String>,
    pub upstream_branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub has_staged_changes: bool,
    pub has_unstaged_changes: bool,
    pub has_untracked_files: bool,
    pub conflicted_count: usize,
    pub stash_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitBranchSummary {
    pub name: String,
    pub full_refname: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream_name: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub head_hash: Option<String>,
    pub head_short_hash: Option<String>,
    pub last_commit_message: Option<String>,
    pub last_commit_date: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SwitchBranchOptions {
    pub stash_if_dirty: bool,
    pub stash_message: Option<String>,
    pub create_tracking: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SwitchBranchResult {
    pub success: bool,
    pub current_branch: String,
    pub previous_branch: Option<String>,
    pub stash_created: bool,
    pub stash_name: Option<String>,
    pub warning: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitSyncResult {
    pub success: bool,
    pub current_branch: String,
    pub upstream_branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub summary: String,
    pub warning: Option<String>,
}
