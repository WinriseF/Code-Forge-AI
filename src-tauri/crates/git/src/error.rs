//! Error types for git operations
//!
//! This module defines errors that can occur during git operations.
//! Errors implement serde::Serialize to be compatible with Tauri commands.

use git2::Error as Git2Error;
use serde::Serialize;
use std::io::Error as IoError;
use thiserror::Error;

/// Main error type for git operations
///
/// The error message is automatically serialized as a string when returned
/// to the frontend via Tauri commands.
#[derive(Debug, Error)]
pub enum GitError {
    /// Generic git2 error
    #[error("Git operation failed: {0}")]
    GitError(#[from] Git2Error),

    /// Generic IO error
    #[error("IO error: {0}")]
    IoError(#[from] IoError),

    /// No files selected for export
    #[error("No files selected for export")]
    NoFilesSelected,

    /// Join error from async operations
    #[error("Async operation failed: {0}")]
    JoinError(String),

    /// Working tree contains changes that must be handled before switching
    #[error("Working tree has uncommitted changes")]
    DirtyWorktree,

    /// The requested branch was not found
    #[error("Branch not found: {0}")]
    BranchNotFound(String),

    /// The working tree contains unresolved conflicts
    #[error("Unresolved conflicts prevent this operation")]
    UnresolvedConflicts,

    /// Creating a stash failed
    #[error("Stash failed: {0}")]
    StashFailed(String),

    /// Current HEAD is detached and cannot be synchronized
    #[error("Detached HEAD is not supported for this operation")]
    DetachedHead,

    /// Current branch has no upstream configured
    #[error("Current branch has no upstream configured")]
    UpstreamNotConfigured,

    /// The local and upstream branches have diverged
    #[error("Branch has diverged from its upstream; complete the merge or rebase manually")]
    DivergedBranch,

    /// The local branch is behind its upstream and cannot be pushed as-is
    #[error("Branch is behind its upstream; pull or rebase before pushing")]
    BehindUpstream,

    /// The remote server rejected an update
    #[error("Remote rejected the update: {0}")]
    RemoteRejected(String),
}

impl Serialize for GitError {
    /// Serialize error as a string message
    ///
    /// Tauri commands require errors to implement Serialize.
    /// We serialize the Display representation of the error.
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

/// Result type alias for git operations
///
/// Usage: `pub fn my_function() -> Result<Value, GitError>`
pub type Result<T> = std::result::Result<T, GitError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_error_variants_format_and_serialize_cleanly() {
        let git = GitError::from(
            git2::Repository::open("__definitely_missing_repo__")
                .err()
                .expect("missing repo"),
        );
        let io = GitError::from(std::io::Error::other("disk failed"));
        let none_selected = GitError::NoFilesSelected;
        let join = GitError::JoinError("join failed".into());

        assert!(git.to_string().contains("Git operation failed:"));
        assert_eq!(io.to_string(), "IO error: disk failed");
        assert_eq!(none_selected.to_string(), "No files selected for export");
        assert_eq!(join.to_string(), "Async operation failed: join failed");

        let serialized = serde_json::to_string(&join).expect("serialize git error");
        assert_eq!(serialized, "\"Async operation failed: join failed\"");
    }
}
