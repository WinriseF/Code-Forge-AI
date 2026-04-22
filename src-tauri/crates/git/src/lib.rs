use tauri::{
    Runtime,
    plugin::{Builder, TauriPlugin},
};

pub mod branch;
pub mod commands;
pub mod error;
pub mod export;
pub mod models;

pub use error::{GitError, Result};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("ctxrun-plugin-git")
        .invoke_handler(tauri::generate_handler![
            commands::get_git_commits,
            commands::get_git_diff,
            commands::get_git_diff_text,
            commands::export_git_diff,
            commands::get_git_log_graph,
            branch::get_git_repo_overview,
            branch::list_git_branches,
            branch::switch_branch,
        ])
        .build()
}
