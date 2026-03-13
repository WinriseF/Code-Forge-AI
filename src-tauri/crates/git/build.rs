fn main() {
    tauri_plugin::Builder::new(&[
        "get_git_repository_summary",
        "list_git_branches",
        "checkout_git_branch",
        "get_git_commits",
        "get_git_branch_commits",
        "get_git_commit_details",
        "get_git_diff",
        "get_git_diff_text",
        "export_git_diff",
    ])
    .build();
}
