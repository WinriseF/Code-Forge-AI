fn main() {
    tauri_plugin::Builder::new(&[
        "get_git_commits",
        "get_git_diff",
        "get_git_diff_text",
        "export_git_diff",
        "get_git_log_graph",
    ])
    .build();
}
