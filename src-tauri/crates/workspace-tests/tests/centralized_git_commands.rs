use std::{
    fs,
    path::PathBuf,
    process,
    time::{SystemTime, UNIX_EPOCH},
};

use ctxrun_plugin_git::{
    commands::{
        checkout_git_branch, export_git_diff, get_git_branch_commits, get_git_commit_details,
        get_git_commits, get_git_diff, get_git_diff_text, get_git_repository_summary,
        list_git_branches,
    },
    models::{ExportFormat, ExportLayout},
};
use git2::{IndexAddOption, Repository, Signature};

fn temp_root(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let root = std::env::temp_dir().join(format!(
        "ctxrun-workspace-tests-{prefix}-{}-{nanos}",
        process::id()
    ));
    fs::create_dir_all(&root).expect("create temp root");
    root
}

fn commit_all(repo: &Repository, message: &str) -> String {
    let mut index = repo.index().expect("open git index");
    index
        .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .expect("git add all");
    index.write().expect("write index");
    let tree_id = index.write_tree().expect("write tree");
    let tree = repo.find_tree(tree_id).expect("find tree");
    let sig = Signature::now("Tester", "tester@example.com").expect("signature");

    let parent = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .and_then(|oid| repo.find_commit(oid).ok());

    let oid = if let Some(parent) = parent {
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])
            .expect("commit with parent")
    } else {
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[])
            .expect("initial commit")
    };

    oid.to_string()
}

fn setup_repo_with_two_commits(prefix: &str) -> (PathBuf, String, String) {
    let root = temp_root(prefix);
    let repo = Repository::init(&root).expect("init git repo");

    fs::write(root.join("file.txt"), "line-1\n").expect("write initial file");
    let old_hash = commit_all(&repo, "initial");

    fs::write(root.join("file.txt"), "line-1\nline-2\n").expect("write modified file");
    let new_hash = commit_all(&repo, "second");

    (root, old_hash, new_hash)
}

fn setup_repo_with_many_commits(prefix: &str, count: usize) -> (PathBuf, Vec<String>) {
    let root = temp_root(prefix);
    let repo = Repository::init(&root).expect("init git repo");
    let mut hashes = Vec::new();

    for index in 0..count {
        fs::write(root.join("file.txt"), format!("line-{index}\n")).expect("write commit file");
        hashes.push(commit_all(&repo, &format!("commit-{index}")));
    }

    hashes.reverse();
    (root, hashes)
}

fn setup_repo_with_feature_branch(prefix: &str) -> (PathBuf, String, String, String) {
    let (root, old_hash, main_hash) = setup_repo_with_two_commits(prefix);
    let repo = Repository::open(&root).expect("open git repo");
    let main_commit = repo.find_commit(git2::Oid::from_str(&main_hash).expect("main oid")).expect("find main commit");
    repo.branch("feature/gitlens", &main_commit, false)
        .expect("create local feature branch");
    repo.set_head("refs/heads/feature/gitlens").expect("switch HEAD to feature branch");
    repo.checkout_head(None).expect("checkout feature branch");

    fs::write(root.join("feature.txt"), "branch-only\n").expect("write branch file");
    let feature_hash = commit_all(&repo, "feature branch commit");

    repo.set_head("refs/heads/master").or_else(|_| repo.set_head("refs/heads/main")).expect("restore main head");
    repo.checkout_head(None).expect("checkout main branch");

    (root, old_hash, main_hash, feature_hash)
}

#[test]
fn centralized_git_commands_get_commits_returns_recent_history() {
    let (root, _old_hash, _new_hash) = setup_repo_with_two_commits("git-commits");

    let commits = get_git_commits(root.to_string_lossy().to_string()).expect("get commits");
    assert!(commits.len() >= 2);
    assert!(!commits[0].hash.is_empty());
    assert!(!commits[0].message.is_empty());
    assert!(commits[0].refs.iter().any(|git_ref| git_ref.ref_type == "head"));
    assert!(commits[0].refs.iter().any(|git_ref| git_ref.ref_type == "local"));
    assert_eq!(commits[0].files_changed, 0);
    assert_eq!(commits[0].additions, 0);
    assert_eq!(commits[0].deletions, 0);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_commands_get_repository_summary_reports_branch_and_dirty_state() {
    let (root, _old_hash, new_hash) = setup_repo_with_two_commits("git-summary");

    fs::write(root.join("notes.txt"), "pending\n").expect("write untracked file");
    fs::write(root.join("file.txt"), "line-1\nline-2\nline-3\n").expect("modify tracked file");

    let summary =
        get_git_repository_summary(root.to_string_lossy().to_string()).expect("get repository summary");
    assert_eq!(summary.repository_name, root.file_name().unwrap().to_string_lossy());
    assert_eq!(summary.head_hash, new_hash);
    assert!(!summary.branch_name.is_empty());
    assert!(summary.is_dirty);
    assert!(summary.untracked_files >= 1);
    assert!(summary.unstaged_changes >= 1);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_commands_list_branches_and_checkout_branch_work() {
    let (root, _old_hash, _main_hash, feature_hash) = setup_repo_with_feature_branch("git-branches");

    let branches = list_git_branches(root.to_string_lossy().to_string()).expect("list branches");
    assert!(branches.iter().any(|branch| branch.short_name == "feature/gitlens"));
    assert!(branches.iter().any(|branch| branch.is_current));

    let summary = checkout_git_branch(
        root.to_string_lossy().to_string(),
        "feature/gitlens".to_string(),
        "local".to_string(),
    )
    .expect("checkout feature branch");
    assert_eq!(summary.branch_name, "feature/gitlens");
    assert_eq!(summary.head_hash, feature_hash);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_commands_get_branch_commits_returns_selected_branch_history() {
    let (root, _old_hash, _main_hash, feature_hash) = setup_repo_with_feature_branch("git-branch-commits");

    let commits = get_git_branch_commits(
        root.to_string_lossy().to_string(),
        "feature/gitlens".to_string(),
        "local".to_string(),
        Some(0),
        Some(20),
    )
    .expect("get feature branch commits");

    assert!(!commits.is_empty());
    assert_eq!(commits[0].hash, feature_hash);
    assert!(commits[0].message.contains("feature branch commit"));
    assert_eq!(commits[0].parent_hashes.len(), 1);
    assert!(commits[0].refs.iter().any(|git_ref| git_ref.name == "feature/gitlens"));
    assert_eq!(commits[0].files_changed, 0);
    assert_eq!(commits[0].additions, 0);
    assert_eq!(commits[0].deletions, 0);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_commands_get_branch_commits_supports_offset_pagination() {
    let (root, hashes) = setup_repo_with_many_commits("git-branch-commits-offset", 5);

    let commits = get_git_branch_commits(
        root.to_string_lossy().to_string(),
        "master".to_string(),
        "local".to_string(),
        Some(2),
        Some(2),
    )
    .or_else(|_| {
        get_git_branch_commits(
            root.to_string_lossy().to_string(),
            "main".to_string(),
            "local".to_string(),
            Some(2),
            Some(2),
        )
    })
    .expect("get paged branch commits");

    assert_eq!(commits.len(), 2);
    assert_eq!(commits[0].hash, hashes[2]);
    assert_eq!(commits[1].hash, hashes[3]);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_commands_get_diff_between_commits_contains_modified_content() {
    let (root, old_hash, new_hash) = setup_repo_with_two_commits("git-diff-tree");

    let diffs = get_git_diff(
        root.to_string_lossy().to_string(),
        old_hash.clone(),
        new_hash.clone(),
    )
    .expect("get git diff");
    assert!(!diffs.is_empty());

    let file = diffs
        .iter()
        .find(|f| f.path == "file.txt")
        .expect("file.txt diff entry");
    assert_eq!(file.status, "Modified");
    assert!(file.original_content.contains("line-1"));
    assert!(file.modified_content.contains("line-2"));
    assert!(!file.is_binary);
    assert!(!file.is_large);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_commands_get_commit_details_reports_parents_and_changed_files() {
    let (root, old_hash, new_hash) = setup_repo_with_two_commits("git-commit-details");

    let details = get_git_commit_details(root.to_string_lossy().to_string(), new_hash.clone())
        .expect("get git commit details");
    assert_eq!(details.hash, new_hash);
    assert_eq!(details.parent_hashes, vec![old_hash]);
    assert!(details.summary.contains("second"));
    assert!(details.changed_files.iter().any(|file| file.path == "file.txt"));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_commands_get_diff_workdir_detects_binary_and_large_files() {
    let (root, _old_hash, new_hash) = setup_repo_with_two_commits("git-diff-workdir");

    fs::write(root.join("bin.dat"), vec![0_u8, 1, 2, 3]).expect("write binary file");
    fs::write(root.join("huge.txt"), "x".repeat(2 * 1024 * 1024 + 32)).expect("write huge file");

    let diffs = get_git_diff(
        root.to_string_lossy().to_string(),
        new_hash,
        "__WORK_DIR__".to_string(),
    )
    .expect("get workdir diff");

    let binary = diffs
        .iter()
        .find(|f| f.path == "bin.dat")
        .expect("binary file entry");
    assert!(binary.is_binary);

    let large = diffs
        .iter()
        .find(|f| f.path == "huge.txt")
        .expect("large file entry");
    assert!(large.is_large);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_commands_get_diff_supports_initial_commit_via_empty_tree() {
    let root = temp_root("git-empty-tree");
    let repo = Repository::init(&root).expect("init git repo");
    fs::write(root.join("initial.txt"), "hello\n").expect("write initial file");
    let initial_hash = commit_all(&repo, "initial");

    let diffs = get_git_diff(
        root.to_string_lossy().to_string(),
        "__EMPTY_TREE__".to_string(),
        initial_hash,
    )
    .expect("get initial commit diff");
    assert_eq!(diffs.len(), 1);
    assert_eq!(diffs[0].status, "Added");
    assert_eq!(diffs[0].path, "initial.txt");

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_commands_get_diff_text_contains_patch_markers() {
    let (root, old_hash, new_hash) = setup_repo_with_two_commits("git-diff-text");

    let diff_text =
        get_git_diff_text(root.to_string_lossy().to_string(), old_hash, new_hash)
            .expect("get diff text");
    assert!(diff_text.contains("@@"));
    assert!(diff_text.contains("+line-2"));

    let _ = fs::remove_dir_all(root);
}

#[tokio::test(flavor = "multi_thread")]
async fn centralized_git_commands_export_diff_handles_success_and_no_selection_error() {
    let (root, old_hash, new_hash) = setup_repo_with_two_commits("git-export");
    let save_path = root.join("diff.md");

    let ok = export_git_diff(
        root.to_string_lossy().to_string(),
        old_hash.clone(),
        new_hash.clone(),
        ExportFormat::Markdown,
        ExportLayout::Unified,
        save_path.to_string_lossy().to_string(),
        vec!["file.txt".into()],
    )
    .await;
    assert!(ok.is_ok(), "export with selected file should succeed");
    let exported = fs::read_to_string(&save_path).expect("read exported diff");
    assert!(exported.contains("file.txt"));

    let err = export_git_diff(
        root.to_string_lossy().to_string(),
        old_hash,
        new_hash,
        ExportFormat::Markdown,
        ExportLayout::Split,
        root.join("empty.md").to_string_lossy().to_string(),
        vec![],
    )
    .await
    .expect_err("export without selected paths should fail");
    assert!(
        err.to_string().contains("No files selected"),
        "expected no-selection error, got: {err}"
    );

    let _ = fs::remove_dir_all(root);
}
