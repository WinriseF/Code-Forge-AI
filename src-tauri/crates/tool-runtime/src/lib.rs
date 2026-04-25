use tauri::{
    Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};

mod agent_fs;
pub mod commands;
mod fs_tools;
mod miner_tools;
pub mod models;
mod runtime;
mod sandbox;

pub type Result<T> = std::result::Result<T, String>;
pub use models::{ToolCallRequest, ToolCallResponse, ToolCallStatus, ToolSpec};
pub use runtime::ToolRuntime;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("ctxrun-plugin-tool-runtime")
        .invoke_handler(tauri::generate_handler![
            commands::list_tools,
            commands::call_tool,
            agent_fs::agent_read_local_file,
            agent_fs::agent_list_local_files,
            agent_fs::agent_search_local_files,
            agent_fs::agent_grep_content,
        ])
        .setup(|app, _api| {
            app.manage(runtime::ToolRuntime::new());
            Ok(())
        })
        .build()
}
