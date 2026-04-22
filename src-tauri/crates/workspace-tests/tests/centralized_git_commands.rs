use std::{
    fs,
    path::PathBuf,
    process,
    time::{SystemTime, UNIX_EPOCH},
};

use ctxrun_plugin_git::{
    branch::{get_git_repo_overview, list_git_branches, switch_branch},
    commands::{
        export_git_diff, get_git_commits, get_git_diff, get_git_diff_text, get_git_log_graph,
    },
    models::{ExportFormat, ExportLayout, GitRefKind, SwitchBranchOptions},
};
use git2::{BranchType, IndexAddOption, Repository, Signature, build::CheckoutBuilder};

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
    repo.checkout_head(Some(&mut checkout))
        .expect("checkout branch");
}

fn setup_repo_with_remote_branch(prefix: &str) -> (PathBuf, PathBuf) {
    let remote_root = temp_root(&format!("{prefix}-remote"));
    let local_root = temp_root(&format!("{prefix}-local"));

    let remote_repo = Repository::init_bare(&remote_root).expect("init bare remote");
    let local_repo = Repository::init(&local_root).expect("init local repo");

    fs::write(local_root.join("file.txt"), "line-1\n").expect("write initial file");
    commit_all(&local_repo, "initial");

    local_repo
        .remote("origin", remote_root.to_string_lossy().as_ref())
        .expect("add origin remote");
    local_repo
        .remote_set_url("origin", remote_root.to_string_lossy().as_ref())
        .expect("ensure remote url");

    let head_commit = local_repo
        .head()
        .expect("head")
        .peel_to_commit()
        .expect("head commit");
    local_repo
        .branch("feature/remote-only", &head_commit, false)
        .expect("create feature branch");
    checkout_branch(&local_repo, "refs/heads/feature/remote-only");
    fs::write(local_root.join("file.txt"), "line-1\nremote-only\n").expect("write feature file");
    commit_all(&local_repo, "remote branch change");

    {
        let mut remote = local_repo.find_remote("origin").expect("find origin");
        remote
            .push(
                &[
                    "refs/heads/master:refs/heads/master",
                    "refs/heads/feature/remote-only:refs/heads/feature/remote-only",
                ],
                None,
            )
            .expect("push branches");
    }

    checkout_branch(&local_repo, "refs/heads/master");
    local_repo
        .find_branch("feature/remote-only", BranchType::Local)
        .expect("find local feature branch")
        .delete()
        .expect("delete local feature branch");
    local_repo
        .find_remote("origin")
        .expect("find origin")
        .fetch(&["feature/remote-only"], None, None)
        .expect("fetch remote branch");

    drop(remote_repo);
    (local_root, remote_root)
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

    let commits = get_git_log_graph(root.to_string_lossy().to_string(), Some(20), Some(0), None)
        .expect("get git log graph");
    let head_commit = commits.first().expect("head commit");

    assert!(
        head_commit
            .refs
            .iter()
            .any(|reference| matches!(reference.kind, GitRefKind::Head))
    );
    assert!(
        head_commit.refs.iter().any(
            |reference| matches!(reference.kind, GitRefKind::Tag) && reference.name == "v1.0.0"
        )
    );

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
fn centralized_git_log_graph_filters_by_message_hash_and_refs() {
    let root = temp_root("git-log-search");
    let repo = Repository::init(&root).expect("init git repo");

    fs::write(root.join("file.txt"), "line-1\n").expect("write initial file");
    commit_all(&repo, "bootstrap");

    fs::write(root.join("file.txt"), "line-1\nsearchable change\n").expect("write feature file");
    let target_hash = commit_all(&repo, "Fix Search Filter");
    let target_commit = repo
        .find_commit(git2::Oid::from_str(&target_hash).expect("parse target oid"))
        .expect("find target commit");
    repo.branch("feature/search-filter", &target_commit, false)
        .expect("create branch");

    let message_matches = get_git_log_graph(
        root.to_string_lossy().to_string(),
        Some(20),
        Some(0),
        Some("search filter".to_string()),
    )
    .expect("search commits by message");
    assert_eq!(message_matches.len(), 1);
    assert_eq!(message_matches[0].hash, target_hash);

    let hash_matches = get_git_log_graph(
        root.to_string_lossy().to_string(),
        Some(20),
        Some(0),
        Some(target_hash[..10].to_string()),
    )
    .expect("search commits by hash");
    assert_eq!(hash_matches.len(), 1);
    assert_eq!(hash_matches[0].hash, target_hash);

    let ref_matches = get_git_log_graph(
        root.to_string_lossy().to_string(),
        Some(20),
        Some(0),
        Some("feature/search-filter".to_string()),
    )
    .expect("search commits by ref");
    assert_eq!(ref_matches.len(), 1);
    assert_eq!(ref_matches[0].hash, target_hash);
    assert!(
        ref_matches[0]
            .refs
            .iter()
            .any(|reference| reference.name == "feature/search-filter")
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_log_graph_applies_pagination_after_search_filtering() {
    let root = temp_root("git-log-search-pagination");
    let repo = Repository::init(&root).expect("init git repo");

    fs::write(root.join("file.txt"), "line-1\n").expect("write initial file");
    commit_all(&repo, "searchable 1");

    fs::write(root.join("file.txt"), "line-1\nline-2\n").expect("write second revision");
    let second_hash = commit_all(&repo, "searchable 2");

    fs::write(root.join("file.txt"), "line-1\nline-2\nline-3\n").expect("write third revision");
    commit_all(&repo, "searchable 3");

    let commits = get_git_log_graph(
        root.to_string_lossy().to_string(),
        Some(1),
        Some(1),
        Some("searchable".to_string()),
    )
    .expect("paginate filtered commits");

    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0].hash, second_hash);

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
    repo.stash_save(&sig, "save stash", None)
        .expect("create stash");

    let commits = get_git_log_graph(root.to_string_lossy().to_string(), Some(50), Some(0), None)
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

    repo.branch("RE1", &head_commit, false)
        .expect("create branch");
    checkout_branch(&repo, "refs/heads/RE1");
    fs::write(root.join("file.txt"), "line-1\nre1-only\n").expect("write branch-only change");
    let re1_hash = commit_all(&repo, "re1 work");

    checkout_branch(&repo, &head_name);
    let mut deleted_branch = repo
        .find_branch("RE1", BranchType::Local)
        .expect("find deleted branch");
    deleted_branch.delete().expect("delete branch");

    let commits = get_git_log_graph(root.to_string_lossy().to_string(), Some(50), Some(0), None)
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

#[test]
fn centralized_git_repo_overview_reports_branch_status() {
    let root = temp_root("git-overview");
    let repo = Repository::init(&root).expect("init git repo");

    fs::write(root.join("file.txt"), "line-1\n").expect("write initial file");
    commit_all(&repo, "initial");
    fs::write(root.join("file.txt"), "line-1\nline-2\n").expect("modify tracked file");
    fs::write(root.join("new.txt"), "new\n").expect("write untracked file");

    let overview =
        get_git_repo_overview(root.to_string_lossy().to_string()).expect("repo overview");
    assert_eq!(overview.current_branch.as_deref(), Some("master"));
    assert!(overview.has_unstaged_changes);
    assert!(overview.has_untracked_files);
    assert_eq!(overview.conflicted_count, 0);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_git_branch_listing_and_remote_switch_create_tracking_branch() {
    let (local_root, remote_root) = setup_repo_with_remote_branch("git-switch-remote");

    let branches = list_git_branches(local_root.to_string_lossy().to_string(), Some(true), None)
        .expect("list git branches");
    let remote_feature = branches
        .iter()
        .find(|branch| branch.full_refname == "refs/remotes/origin/feature/remote-only")
        .expect("remote feature branch");
    assert!(remote_feature.is_remote);

    let result = switch_branch(
        local_root.to_string_lossy().to_string(),
        remote_feature.full_refname.clone(),
        SwitchBranchOptions {
            stash_if_dirty: false,
            stash_message: None,
            create_tracking: true,
        },
    )
    .expect("switch to remote tracking branch");

    assert!(result.success);
    assert_eq!(result.current_branch, "feature/remote-only");

    let repo = Repository::open(&local_root).expect("reopen local repo");
    let local_tracking = repo
        .find_branch("feature/remote-only", BranchType::Local)
        .expect("find created local branch");
    let upstream_branch = local_tracking.upstream().expect("tracking upstream");
    let upstream = upstream_branch
        .name()
        .expect("upstream name")
        .expect("upstream value");
    assert_eq!(upstream, "origin/feature/remote-only");

    let _ = fs::remove_dir_all(local_root);
    let _ = fs::remove_dir_all(remote_root);
}

#[test]
fn centralized_git_switch_branch_blocks_dirty_worktree_without_stash() {
    let root = temp_root("git-switch-dirty");
    let repo = Repository::init(&root).expect("init git repo");

    fs::write(root.join("file.txt"), "line-1\n").expect("write initial file");
    commit_all(&repo, "initial");

    let head_commit = repo
        .head()
        .expect("head")
        .peel_to_commit()
        .expect("head commit");
    repo.branch("feature/test", &head_commit, false)
        .expect("create feature branch");

    fs::write(root.join("file.txt"), "line-1\ndirty\n").expect("write dirty file");

    let err = switch_branch(
        root.to_string_lossy().to_string(),
        "refs/heads/feature/test".to_string(),
        SwitchBranchOptions {
            stash_if_dirty: false,
            stash_message: None,
            create_tracking: false,
        },
    )
    .expect_err("dirty worktree should be rejected");

    assert!(
        err.to_string()
            .contains("Working tree has uncommitted changes")
    );

    let _ = fs::remove_dir_all(root);
}
