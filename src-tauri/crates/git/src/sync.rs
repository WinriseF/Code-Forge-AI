use crate::branch::{branch_ahead_behind, collect_worktree_status, current_branch_name};
use crate::error::{GitError, Result};
use crate::models::GitSyncResult;
use git2::{
    BranchType, Cred, CredentialType, FetchOptions, Oid, PushOptions, Reference, RemoteCallbacks,
    Repository, build::CheckoutBuilder,
};
use std::cell::RefCell;
use std::rc::Rc;

struct TrackingBranchTarget {
    current_branch: String,
    local_refname: String,
    upstream_branch: String,
    upstream_refname: String,
    remote_name: String,
    remote_branch_name: String,
    ahead: usize,
    behind: usize,
}

fn tracking_branch_target(repo: &Repository) -> Result<TrackingBranchTarget> {
    let current_branch = current_branch_name(repo).ok_or(GitError::DetachedHead)?;
    let local_branch = repo.find_branch(&current_branch, BranchType::Local)?;
    let upstream = local_branch
        .upstream()
        .map_err(|_| GitError::UpstreamNotConfigured)?;
    let upstream_branch = upstream
        .name()
        .ok()
        .flatten()
        .map(ToOwned::to_owned)
        .ok_or(GitError::UpstreamNotConfigured)?;
    let upstream_refname = upstream
        .get()
        .name()
        .map(ToOwned::to_owned)
        .ok_or(GitError::UpstreamNotConfigured)?;
    let Some((remote_name, remote_branch_name)) = upstream_branch.split_once('/') else {
        return Err(GitError::UpstreamNotConfigured);
    };
    let remote_name = remote_name.to_string();
    let remote_branch_name = remote_branch_name.to_string();
    let (ahead, behind, _) = branch_ahead_behind(repo, &local_branch);

    Ok(TrackingBranchTarget {
        current_branch: current_branch.clone(),
        local_refname: format!("refs/heads/{current_branch}"),
        upstream_branch,
        upstream_refname,
        remote_name,
        remote_branch_name,
        ahead,
        behind,
    })
}

fn build_remote_callbacks(repo: &Repository) -> RemoteCallbacks<'static> {
    let config = repo.config().ok();
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |url, username_from_url, allowed_types| {
        if allowed_types.contains(CredentialType::SSH_KEY)
            && let Some(username) = username_from_url
            && let Ok(cred) = Cred::ssh_key_from_agent(username)
        {
            return Ok(cred);
        }

        if allowed_types.contains(CredentialType::USER_PASS_PLAINTEXT)
            && let Some(config) = config.as_ref()
            && let Ok(cred) = Cred::credential_helper(config, url, username_from_url)
        {
            return Ok(cred);
        }

        if allowed_types.contains(CredentialType::DEFAULT)
            && let Ok(cred) = Cred::default()
        {
            return Ok(cred);
        }

        if allowed_types.contains(CredentialType::USERNAME)
            && let Some(username) = username_from_url
        {
            return Cred::username(username);
        }

        Err(git2::Error::from_str("authentication failed"))
    });
    callbacks
}

fn branch_sync_result(
    repo: &Repository,
    current_branch: &str,
    summary: String,
) -> Result<GitSyncResult> {
    let branch = repo.find_branch(current_branch, BranchType::Local)?;
    let (ahead, behind, upstream_branch) = branch_ahead_behind(repo, &branch);

    Ok(GitSyncResult {
        success: true,
        current_branch: current_branch.to_string(),
        upstream_branch,
        ahead,
        behind,
        summary,
        warning: None,
    })
}

fn update_tracking_reference(
    repo: &Repository,
    upstream_refname: &str,
    target_oid: Oid,
    reflog_message: &str,
) -> Result<()> {
    match repo.find_reference(upstream_refname) {
        Ok(mut reference) => {
            reference.set_target(target_oid, reflog_message)?;
        }
        Err(_) => {
            repo.reference(upstream_refname, target_oid, true, reflog_message)?;
        }
    }

    Ok(())
}

fn fast_forward_local_branch(
    repo: &Repository,
    reference: &Reference<'_>,
    local_refname: &str,
    current_branch: &str,
) -> Result<()> {
    let target_oid = reference
        .target()
        .ok_or_else(|| GitError::BranchNotFound(local_refname.to_string()))?;
    match repo.find_reference(local_refname) {
        Ok(mut branch_ref) => {
            branch_ref.set_target(target_oid, &format!("pull: fast-forward {current_branch}"))?;
        }
        Err(_) => {
            repo.reference(
                local_refname,
                target_oid,
                true,
                &format!("pull: fast-forward {current_branch}"),
            )?;
        }
    }
    repo.set_head(local_refname)?;
    let mut checkout = CheckoutBuilder::new();
    checkout.force();
    checkout.recreate_missing(true);
    repo.checkout_head(Some(&mut checkout))?;
    Ok(())
}

fn fetch_tracking_branch(repo: &Repository, tracking: &TrackingBranchTarget) -> Result<()> {
    let fetch_refspec = format!(
        "+refs/heads/{}:{}",
        tracking.remote_branch_name, tracking.upstream_refname
    );
    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(build_remote_callbacks(repo));
    let mut remote = repo.find_remote(&tracking.remote_name)?;
    remote.fetch(
        &[fetch_refspec.as_str()],
        Some(&mut fetch_options),
        Some("ctxrun sync tracking branch"),
    )?;

    Ok(())
}

#[tauri::command]
pub fn push_current_branch(project_path: String) -> Result<GitSyncResult> {
    let repo = Repository::open(project_path)?;
    let worktree = collect_worktree_status(&repo)?;
    if worktree.conflicted_count > 0 {
        return Err(GitError::UnresolvedConflicts);
    }

    let tracking = tracking_branch_target(&repo)?;
    fetch_tracking_branch(&repo, &tracking)?;
    let tracking = tracking_branch_target(&repo)?;
    if tracking.behind > 0 {
        return Err(if tracking.ahead > 0 {
            GitError::DivergedBranch
        } else {
            GitError::BehindUpstream
        });
    }

    if tracking.ahead == 0 {
        return branch_sync_result(
            &repo,
            &tracking.current_branch,
            format!(
                "{} is already up to date on {}",
                tracking.current_branch, tracking.upstream_branch
            ),
        );
    }

    let head_oid = repo.head()?.target().ok_or(GitError::DetachedHead)?;
    let rejected_update = Rc::new(RefCell::new(None::<String>));
    let rejection_cell = Rc::clone(&rejected_update);
    let mut callbacks = build_remote_callbacks(&repo);
    callbacks.push_update_reference(move |reference_name, status| {
        if let Some(status) = status {
            *rejection_cell.borrow_mut() = Some(format!("{reference_name}: {status}"));
        }
        Ok(())
    });

    let mut options = PushOptions::new();
    options.remote_callbacks(callbacks);
    let mut remote = repo.find_remote(&tracking.remote_name)?;
    let push_refspec = format!(
        "{}:refs/heads/{}",
        tracking.local_refname, tracking.remote_branch_name
    );
    remote.push(&[push_refspec.as_str()], Some(&mut options))?;

    if let Some(message) = rejected_update.borrow().clone() {
        return Err(GitError::RemoteRejected(message));
    }

    update_tracking_reference(
        &repo,
        &tracking.upstream_refname,
        head_oid,
        &format!("push: update {}", tracking.upstream_branch),
    )?;

    branch_sync_result(
        &repo,
        &tracking.current_branch,
        format!(
            "Pushed {} to {}",
            tracking.current_branch, tracking.upstream_branch
        ),
    )
}

#[tauri::command]
pub fn pull_current_branch(project_path: String) -> Result<GitSyncResult> {
    let repo = Repository::open(project_path)?;
    let worktree = collect_worktree_status(&repo)?;
    if worktree.conflicted_count > 0 {
        return Err(GitError::UnresolvedConflicts);
    }
    if worktree.has_staged_changes || worktree.has_unstaged_changes || worktree.has_untracked_files
    {
        return Err(GitError::DirtyWorktree);
    }

    let tracking = tracking_branch_target(&repo)?;
    fetch_tracking_branch(&repo, &tracking)?;

    let upstream_reference = repo.find_reference(&tracking.upstream_refname)?;
    let upstream_commit = repo.reference_to_annotated_commit(&upstream_reference)?;
    let (analysis, _) = repo.merge_analysis(&[&upstream_commit])?;

    if analysis.is_up_to_date() {
        return branch_sync_result(
            &repo,
            &tracking.current_branch,
            format!("{} is already up to date", tracking.current_branch),
        );
    }

    if analysis.is_fast_forward() || analysis.is_unborn() {
        fast_forward_local_branch(
            &repo,
            &upstream_reference,
            &tracking.local_refname,
            &tracking.current_branch,
        )?;
        return branch_sync_result(
            &repo,
            &tracking.current_branch,
            format!(
                "Fast-forwarded {} from {}",
                tracking.current_branch, tracking.upstream_branch
            ),
        );
    }

    Err(GitError::DivergedBranch)
}
