use crate::error::{GitError, Result};
use crate::models::{GitBranchSummary, GitRepoOverview, SwitchBranchOptions, SwitchBranchResult};
use chrono::{DateTime, Local};
use git2::{
    Branch, BranchType, Repository, Signature, Status, StatusOptions, build::CheckoutBuilder,
};

#[derive(Default)]
pub(crate) struct WorktreeStatusSummary {
    pub(crate) has_staged_changes: bool,
    pub(crate) has_unstaged_changes: bool,
    pub(crate) has_untracked_files: bool,
    pub(crate) conflicted_count: usize,
}

pub(crate) fn format_commit_time(time: git2::Time) -> String {
    let dt = DateTime::from_timestamp(time.seconds(), 0).unwrap_or_default();
    dt.with_timezone(&Local)
        .format("%Y-%m-%d %H:%M")
        .to_string()
}

pub(crate) fn current_branch_name(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if !head.is_branch() {
        return None;
    }
    head.shorthand().map(ToOwned::to_owned)
}

fn shorten_hash(hash: &str) -> String {
    hash.chars().take(7).collect()
}

pub(crate) fn collect_worktree_status(repo: &Repository) -> Result<WorktreeStatusSummary> {
    let mut options = StatusOptions::new();
    options.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut options))?;
    let mut summary = WorktreeStatusSummary::default();

    for entry in statuses.iter() {
        let status = entry.status();

        if status.contains(Status::CONFLICTED) {
            summary.conflicted_count += 1;
            continue;
        }

        if status.intersects(
            Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED
                | Status::INDEX_TYPECHANGE,
        ) {
            summary.has_staged_changes = true;
        }

        if status.intersects(
            Status::WT_MODIFIED | Status::WT_DELETED | Status::WT_RENAMED | Status::WT_TYPECHANGE,
        ) {
            summary.has_unstaged_changes = true;
        }

        if status.contains(Status::WT_NEW) {
            summary.has_untracked_files = true;
        }
    }

    Ok(summary)
}

fn count_stashes(repo: &mut Repository) -> usize {
    let mut count = 0usize;
    let _ = repo.stash_foreach(|_, _, _| {
        count += 1;
        true
    });
    count
}

pub(crate) fn branch_ahead_behind(
    repo: &Repository,
    branch: &Branch<'_>,
) -> (usize, usize, Option<String>) {
    let upstream = match branch.upstream() {
        Ok(upstream) => upstream,
        Err(_) => return (0, 0, None),
    };

    let upstream_name = upstream.name().ok().flatten().map(ToOwned::to_owned);
    let local_oid = branch.get().target();
    let upstream_oid = upstream.get().target();

    match (local_oid, upstream_oid) {
        (Some(local_oid), Some(upstream_oid)) => {
            match repo.graph_ahead_behind(local_oid, upstream_oid) {
                Ok((ahead, behind)) => (ahead, behind, upstream_name),
                Err(_) => (0, 0, upstream_name),
            }
        }
        _ => (0, 0, upstream_name),
    }
}

pub(crate) fn checkout_branch(repo: &Repository, reference_name: &str) -> Result<()> {
    repo.set_head(reference_name)?;
    let mut checkout = CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout))?;
    Ok(())
}

fn create_tracking_branch(repo: &Repository, remote_branch_refname: &str) -> Result<String> {
    let Some(remote_name) = remote_branch_refname.strip_prefix("refs/remotes/") else {
        return Err(GitError::BranchNotFound(remote_branch_refname.to_string()));
    };
    let mut parts = remote_name.splitn(2, '/');
    let _remote = parts.next();
    let Some(local_branch_name) = parts.next().filter(|value| !value.is_empty()) else {
        return Err(GitError::BranchNotFound(remote_branch_refname.to_string()));
    };

    let remote_branch = repo.find_branch(remote_name, BranchType::Remote)?;
    let target_commit = remote_branch.get().peel_to_commit()?;
    repo.branch(local_branch_name, &target_commit, false)?;
    let mut local_branch = repo.find_branch(local_branch_name, BranchType::Local)?;
    local_branch.set_upstream(Some(remote_name))?;

    Ok(format!("refs/heads/{local_branch_name}"))
}

fn open_branch_by_refname<'repo>(
    repo: &'repo Repository,
    full_refname: &str,
) -> Result<(Branch<'repo>, bool)> {
    if let Some(local_name) = full_refname.strip_prefix("refs/heads/") {
        return Ok((repo.find_branch(local_name, BranchType::Local)?, false));
    }
    if let Some(remote_name) = full_refname.strip_prefix("refs/remotes/") {
        return Ok((repo.find_branch(remote_name, BranchType::Remote)?, true));
    }

    Err(GitError::BranchNotFound(full_refname.to_string()))
}

fn branch_commit_summary(
    branch: &Branch<'_>,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let Ok(commit) = branch.get().peel_to_commit() else {
        return (None, None, None, None);
    };

    let hash = commit.id().to_string();
    let short_hash = shorten_hash(&hash);
    let summary = commit.summary().map(ToOwned::to_owned);
    let date = Some(format_commit_time(commit.time()));

    (Some(hash), Some(short_hash), summary, date)
}

fn stash_signature(repo: &Repository) -> Result<Signature<'static>> {
    if let Ok(config) = repo.config() {
        let name = config
            .get_string("user.name")
            .unwrap_or_else(|_| "CtxRun".to_string());
        let email = config
            .get_string("user.email")
            .unwrap_or_else(|_| "ctxrun@local".to_string());
        return Signature::now(&name, &email).map_err(GitError::from);
    }

    Signature::now("CtxRun", "ctxrun@local").map_err(GitError::from)
}

#[tauri::command]
pub fn get_git_repo_overview(project_path: String) -> Result<GitRepoOverview> {
    let mut repo = Repository::open(project_path)?;
    let head = repo.head().ok();
    let is_detached_head = head.as_ref().is_some_and(|head| !head.is_branch());
    let target_oid = head.as_ref().and_then(|head| head.target());
    let current_branch = current_branch_name(&repo);
    let (head_hash, head_short_hash) = target_oid
        .map(|oid| {
            let hash = oid.to_string();
            let short_hash = shorten_hash(&hash);
            (Some(hash), Some(short_hash))
        })
        .unwrap_or((None, None));
    drop(head);

    let worktree = collect_worktree_status(&repo)?;
    let stash_count = count_stashes(&mut repo);

    let (ahead, behind, upstream_branch) = match current_branch.as_deref() {
        Some(branch_name) => {
            let branch = repo.find_branch(branch_name, BranchType::Local)?;
            branch_ahead_behind(&repo, &branch)
        }
        None => (0, 0, None),
    };

    Ok(GitRepoOverview {
        current_branch,
        is_detached_head,
        head_hash,
        head_short_hash,
        upstream_branch,
        ahead,
        behind,
        has_staged_changes: worktree.has_staged_changes,
        has_unstaged_changes: worktree.has_unstaged_changes,
        has_untracked_files: worktree.has_untracked_files,
        conflicted_count: worktree.conflicted_count,
        stash_count,
    })
}

#[tauri::command]
pub fn list_git_branches(
    project_path: String,
    include_remote: Option<bool>,
    query: Option<String>,
) -> Result<Vec<GitBranchSummary>> {
    let repo = Repository::open(project_path)?;
    let include_remote = include_remote.unwrap_or(true);
    let normalized_query = query.unwrap_or_default().trim().to_ascii_lowercase();

    let mut branches = Vec::new();

    for branch_result in repo.branches(Some(BranchType::Local))? {
        let (branch, _) = branch_result?;
        let Some(name) = branch.name().ok().flatten().map(ToOwned::to_owned) else {
            continue;
        };

        let (ahead, behind, upstream_name) = branch_ahead_behind(&repo, &branch);
        let (head_hash, head_short_hash, last_commit_message, last_commit_date) =
            branch_commit_summary(&branch);

        if !normalized_query.is_empty() {
            let matches = name.to_ascii_lowercase().contains(&normalized_query)
                || upstream_name.as_deref().is_some_and(|upstream| {
                    upstream.to_ascii_lowercase().contains(&normalized_query)
                })
                || last_commit_message.as_deref().is_some_and(|message| {
                    message.to_ascii_lowercase().contains(&normalized_query)
                });
            if !matches {
                continue;
            }
        }

        branches.push(GitBranchSummary {
            name: name.clone(),
            full_refname: format!("refs/heads/{name}"),
            is_current: branch.is_head(),
            is_remote: false,
            upstream_name,
            ahead,
            behind,
            head_hash,
            head_short_hash,
            last_commit_message,
            last_commit_date,
        });
    }

    if include_remote {
        for branch_result in repo.branches(Some(BranchType::Remote))? {
            let (branch, _) = branch_result?;
            let Some(name) = branch.name().ok().flatten().map(ToOwned::to_owned) else {
                continue;
            };
            if name.ends_with("/HEAD") {
                continue;
            }

            let (head_hash, head_short_hash, last_commit_message, last_commit_date) =
                branch_commit_summary(&branch);

            if !normalized_query.is_empty() {
                let matches = name.to_ascii_lowercase().contains(&normalized_query)
                    || last_commit_message.as_deref().is_some_and(|message| {
                        message.to_ascii_lowercase().contains(&normalized_query)
                    });
                if !matches {
                    continue;
                }
            }

            branches.push(GitBranchSummary {
                name: name.clone(),
                full_refname: format!("refs/remotes/{name}"),
                is_current: false,
                is_remote: true,
                upstream_name: None,
                ahead: 0,
                behind: 0,
                head_hash,
                head_short_hash,
                last_commit_message,
                last_commit_date,
            });
        }
    }

    branches.sort_by(|left, right| {
        left.is_current
            .cmp(&right.is_current)
            .reverse()
            .then_with(|| left.is_remote.cmp(&right.is_remote))
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(branches)
}

#[tauri::command]
pub fn switch_branch(
    project_path: String,
    target_branch: String,
    options: SwitchBranchOptions,
) -> Result<SwitchBranchResult> {
    let mut repo = Repository::open(project_path)?;
    let previous_branch = current_branch_name(&repo);
    let worktree = collect_worktree_status(&repo)?;

    if worktree.conflicted_count > 0 {
        return Err(GitError::UnresolvedConflicts);
    }

    let is_dirty = worktree.has_staged_changes || worktree.has_unstaged_changes;
    if is_dirty && !options.stash_if_dirty {
        return Err(GitError::DirtyWorktree);
    }

    let (target_ref, is_remote) = open_branch_by_refname(&repo, &target_branch).map(|_| {
        (
            target_branch.clone(),
            target_branch.starts_with("refs/remotes/"),
        )
    })?;

    let checkout_ref = if is_remote && options.create_tracking {
        create_tracking_branch(&repo, &target_ref)?
    } else {
        if is_remote {
            return Err(GitError::BranchNotFound(target_ref));
        }
        target_ref
    };

    let mut stash_created = false;
    let mut stash_name = None;
    if is_dirty {
        let signature = stash_signature(&repo)?;
        let message = options
            .stash_message
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                let branch = previous_branch
                    .clone()
                    .unwrap_or_else(|| "detached-head".to_string());
                format!("WIP: on {branch}")
            });
        repo.stash_save(&signature, &message, None)
            .map_err(|err| GitError::StashFailed(err.message().to_string()))?;
        stash_created = true;
        stash_name = Some("stash@{0}".to_string());
    }

    checkout_branch(&repo, &checkout_ref)?;
    let current_branch =
        current_branch_name(&repo).unwrap_or_else(|| checkout_ref.replace("refs/heads/", ""));

    Ok(SwitchBranchResult {
        success: true,
        current_branch,
        previous_branch,
        stash_created,
        stash_name,
        warning: None,
    })
}
