use std::{
    fs,
    path::PathBuf,
    process,
    time::{SystemTime, UNIX_EPOCH},
};

use ctxrun_plugin_git::{
    commands::{export_git_diff, get_git_commits, get_git_diff, get_git_diff_text, get_git_log_graph},
    models::{ExportFormat, ExportLayout, GitRefKind},
};
use git2::{build::CheckoutBuilder, BranchType, IndexAddOption, Repository, Signature};

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

fn checkout_branch(repo: &Repository, refname: &str) {
    repo.set_head(refname).expect("set HEAD");
    let mut checkout = CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout)).expect("checkout branch");
}

#[test]
fn centralized_git_commands_get_commits_returns_recent_history() {
    let (root, _old_hash, _new_hash) = setup_repo_with_two_commits("git-commits");

    let commits = get_git_commits(root.to_string_lossy().to_string()).expect("get commits");
    assert!(commits.len() >= 2);
    assert!(!commits[0].hash.is_empty());
    assert!(!commits[0].message.is_empty());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_log_graph_peels_annotated_tags_to_the_commit() {
    let root = temp_root("git-log-graph");
    let repo = Repository::init(&root).expect("init git repo");

    fs::write(root.join("file.txt"), "line-1\n").expect("write initial file");
    let commit_hash = commit_all(&repo, "initial");
    let commit_oid = git2::Oid::from_str(&commit_hash).expect("parse commit oid");
    let commit_object = repo
        .find_object(commit_oid, Some(git2::ObjectType::Commit))
        .expect("find commit object");
    let sig = Signature::now("Tester", "tester@example.com").expect("signature");
    repo.tag("v1.0.0", &commit_object, &sig, "release", false)
        .expect("create annotated tag");

    let commits = get_git_log_graph(root.to_string_lossy().to_string(), Some(20), Some(0))
        .expect("get git log graph");
    let head_commit = commits.first().expect("head commit");

    assert!(head_commit
        .refs
        .iter()
        .any(|reference| matches!(reference.kind, GitRefKind::Head)));
    assert!(head_commit
        .refs
        .iter()
        .any(|reference| matches!(reference.kind, GitRefKind::Tag) && reference.name == "v1.0.0"));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_commands_get_diff_between_commits_contains_modified_content() {
    let (root, old_hash, new_hash) = setup_repo_with_two_commits("git-diff-tree");

    let diff = get_git_diff(
        root.to_string_lossy().to_string(),
        old_hash.clone(),
        new_hash.clone(),
    )
    .expect("get git diff");
    assert!(!diff.files.is_empty());
    assert_eq!(diff.summary.files_changed, 1);
    assert_eq!(diff.summary.files_modified, 1);
    assert_eq!(diff.summary.insertions, 1);
    assert_eq!(diff.summary.deletions, 0);

    let file = diff
        .files
        .iter()
        .find(|f| f.path == "file.txt")
        .expect("file.txt diff entry");
    assert_eq!(file.status, "Modified");
    assert!(file.original_content.contains("line-1"));
    assert!(file.modified_content.contains("line-2"));
    assert!(!file.is_binary);
    assert!(!file.is_large);
    assert_eq!(file.additions, 1);
    assert_eq!(file.deletions, 0);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_commands_get_diff_workdir_detects_binary_and_large_files() {
    let (root, _old_hash, new_hash) = setup_repo_with_two_commits("git-diff-workdir");

    fs::write(root.join("bin.dat"), vec![0_u8, 1, 2, 3]).expect("write binary file");
    fs::write(root.join("huge.txt"), "x".repeat(2 * 1024 * 1024 + 32)).expect("write huge file");

    let diff = get_git_diff(
        root.to_string_lossy().to_string(),
        new_hash,
        "__WORK_DIR__".to_string(),
    )
    .expect("get workdir diff");
    assert_eq!(diff.summary.files_changed, 2);
    assert_eq!(diff.summary.files_added, 2);

    let binary = diff
        .files
        .iter()
        .find(|f| f.path == "bin.dat")
        .expect("binary file entry");
    assert!(binary.is_binary);

    let large = diff
        .files
        .iter()
        .find(|f| f.path == "huge.txt")
        .expect("large file entry");
    assert!(large.is_large);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_log_graph_includes_stash_entries() {
    let root = temp_root("git-log-stash");
    let mut repo = Repository::init(&root).expect("init git repo");

    fs::write(root.join("file.txt"), "line-1\n").expect("write initial file");
    commit_all(&repo, "initial");

    fs::write(root.join("file.txt"), "line-1\nstash-change\n").expect("write stashed change");
    let sig = Signature::now("Tester", "tester@example.com").expect("signature");
    repo.stash_save(&sig, "save stash", None).expect("create stash");

    let commits = get_git_log_graph(root.to_string_lossy().to_string(), Some(50), Some(0))
        .expect("get git log graph");
    assert!(commits.iter().any(|commit| {
        commit
            .refs
            .iter()
            .any(|reference| matches!(reference.kind, GitRefKind::Stash))
    }));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_log_graph_restores_deleted_branch_hints_from_head_reflog() {
    let root = temp_root("git-log-deleted-branch");
    let repo = Repository::init(&root).expect("init git repo");

    fs::write(root.join("file.txt"), "line-1\n").expect("write initial file");
    commit_all(&repo, "initial");

    let head_name = repo
        .head()
        .expect("head")
        .name()
        .expect("head ref name")
        .to_string();
    let head_commit = repo
        .head()
        .expect("head")
        .peel_to_commit()
        .expect("peel head to commit");

    repo.branch("RE1", &head_commit, false).expect("create branch");
    checkout_branch(&repo, "refs/heads/RE1");
    fs::write(root.join("file.txt"), "line-1\nre1-only\n").expect("write branch-only change");
    let re1_hash = commit_all(&repo, "re1 work");

    checkout_branch(&repo, &head_name);
    let mut deleted_branch = repo
        .find_branch("RE1", BranchType::Local)
        .expect("find deleted branch");
    deleted_branch.delete().expect("delete branch");

    let commits = get_git_log_graph(root.to_string_lossy().to_string(), Some(50), Some(0))
        .expect("get git log graph");
    let deleted_branch_commit = commits
        .iter()
        .find(|commit| commit.hash == re1_hash)
        .expect("deleted branch commit should still be reachable through reflog roots");
    assert!(deleted_branch_commit.refs.iter().any(|reference| {
        matches!(reference.kind, GitRefKind::DeletedBranch) && reference.name == "RE1"
    }));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_commands_get_diff_text_contains_patch_markers() {
    let (root, old_hash, new_hash) = setup_repo_with_two_commits("git-diff-text");

    let diff_text = get_git_diff_text(root.to_string_lossy().to_string(), old_hash, new_hash)
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
