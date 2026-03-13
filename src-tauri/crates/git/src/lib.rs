use tauri::{
    Runtime,
    plugin::{Builder, TauriPlugin},
};

pub mod commands;
pub mod error;
pub mod export;
pub mod models;

pub use error::{GitError, Result};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("ctxrun-plugin-git")
        .invoke_handler(tauri::generate_handler![
            commands::get_git_repository_summary,
            commands::list_git_branches,
            commands::checkout_git_branch,
            commands::get_git_commits,
            commands::get_git_branch_commits,
            commands::get_git_commit_details,
            commands::get_git_diff,
            commands::get_git_diff_text,
            commands::export_git_diff,
        ])
        .build()
}
