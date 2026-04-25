fn main() {
    tauri_plugin::Builder::new(&[
        "list_tools",
        "call_tool",
        "agent_set_workspace_root",
        "agent_read_local_file",
        "agent_list_local_files",
        "agent_search_local_files",
        "agent_grep_content",
    ])
    .build();
}
