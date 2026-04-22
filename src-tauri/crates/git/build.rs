fn main() {
    tauri_plugin::Builder::new(&[
        "get_git_commits",
        "get_git_diff",
        "get_git_diff_text",
        "export_git_diff",
        "get_git_log_graph",
        "get_git_repo_overview",
        "list_git_branches",
        "switch_branch",
    ])
    .build();
}
