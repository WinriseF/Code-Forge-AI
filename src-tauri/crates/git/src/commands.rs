use crate::error::{GitError, Result};
use crate::export::generate_export_content;
use crate::models::{
    ExportFormat, ExportLayout, GitBranchRef, GitCommit, GitCommitChange, GitCommitDetails,
    GitCommitRef, GitDiffFile, GitRepositorySummary,
};
use chrono::{DateTime, Local};
use git2::{
    BranchType, Delta, DiffFormat, DiffOptions, Oid, Repository, Status, StatusOptions,
    build::CheckoutBuilder,
};
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::path::Path;

struct DiffItem {
    path: String,
    status: String,
    old_path: Option<String>,
    old_oid: Oid,
    new_oid: Oid,
    delta_status: Delta,
}

fn format_timestamp(seconds: i64) -> String {
    DateTime::from_timestamp(seconds, 0)
        .unwrap_or_default()
        .with_timezone(&Local)
        .format("%Y-%m-%d %H:%M")
        .to_string()
}

fn delta_status_label(delta: Delta) -> &'static str {
    match delta {
        Delta::Added => "Added",
        Delta::Deleted => "Deleted",
        Delta::Modified => "Modified",
        Delta::Renamed => "Renamed",
        _ => "Modified",
    }
}

fn has_index_status(status: Status) -> bool {
    status.is_index_new()
        || status.is_index_modified()
        || status.is_index_deleted()
        || status.is_index_renamed()
        || status.is_index_typechange()
}

fn has_worktree_status(status: Status) -> bool {
    status.is_wt_modified()
        || status.is_wt_deleted()
        || status.is_wt_renamed()
        || status.is_wt_typechange()
        || status.is_conflicted()
}

fn branch_type_label(branch_type: BranchType) -> &'static str {
    match branch_type {
        BranchType::Local => "local",
        BranchType::Remote => "remote",
    }
}

fn parse_branch_type(branch_type: &str) -> BranchType {
    if branch_type.eq_ignore_ascii_case("remote") {
        BranchType::Remote
    } else {
        BranchType::Local
    }
}

fn ref_type_order(ref_type: &str) -> usize {
    match ref_type {
        "head" => 0,
        "local" => 1,
        "remote" => 2,
        "tag" => 3,
        _ => 4,
    }
}

fn push_commit_ref(
    refs_by_oid: &mut HashMap<Oid, Vec<GitCommitRef>>,
    oid: Oid,
    name: String,
    ref_type: &str,
) {
    let entry = refs_by_oid.entry(oid).or_default();
    if entry
        .iter()
        .any(|existing| existing.name == name && existing.ref_type == ref_type)
    {
        return;
    }

    entry.push(GitCommitRef {
        name,
        ref_type: ref_type.to_string(),
    });
}

fn collect_commit_refs(repo: &Repository) -> Result<HashMap<Oid, Vec<GitCommitRef>>> {
    let mut refs_by_oid: HashMap<Oid, Vec<GitCommitRef>> = HashMap::new();

    if let Ok(head) = repo.head() {
        if let Some(target) = head.target() {
            push_commit_ref(&mut refs_by_oid, target, "HEAD".to_string(), "head");
        }
    }

    for branch_type in [BranchType::Local, BranchType::Remote] {
        for branch_result in repo.branches(Some(branch_type))? {
            let (branch, actual_type) = branch_result?;
            let Some(commit) = branch.get().peel_to_commit().ok() else {
                continue;
            };
            let Some(short_name) = branch.name()?.map(|value| value.to_string()) else {
                continue;
            };

            push_commit_ref(
                &mut refs_by_oid,
                commit.id(),
                short_name,
                branch_type_label(actual_type),
            );
        }
    }

    let tag_names = repo.tag_names(None)?;
    for tag_name in tag_names.iter().flatten() {
        let reference_name = format!("refs/tags/{tag_name}");
        let Ok(reference) = repo.find_reference(&reference_name) else {
            continue;
        };
        let Ok(commit) = reference.peel_to_commit() else {
            continue;
        };
        push_commit_ref(&mut refs_by_oid, commit.id(), tag_name.to_string(), "tag");
    }

    for refs in refs_by_oid.values_mut() {
        refs.sort_by(|left, right| {
            ref_type_order(&left.ref_type)
                .cmp(&ref_type_order(&right.ref_type))
                .then(left.name.cmp(&right.name))
        });
    }

    Ok(refs_by_oid)
}

fn collect_commit_stats(repo: &Repository, commit: &git2::Commit<'_>) -> Result<(usize, usize, usize)> {
    let commit_tree = commit.tree()?;
    let parent_tree = commit.parents().next().map(|parent| parent.tree()).transpose()?;
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit_tree), None)?;
    let stats = diff.stats()?;

    Ok((stats.files_changed(), stats.insertions(), stats.deletions()))
}

fn build_git_commit(
    repo: &Repository,
    commit: &git2::Commit<'_>,
    refs_by_oid: &HashMap<Oid, Vec<GitCommitRef>>,
    with_stats: bool,
) -> Result<GitCommit> {
    let (files_changed, additions, deletions) = if with_stats {
        collect_commit_stats(repo, commit)?
    } else {
        (0, 0, 0)
    };

    Ok(GitCommit {
        hash: commit.id().to_string(),
        author: commit.author().name().unwrap_or("Unknown").to_string(),
        date: format_timestamp(commit.time().seconds()),
        message: commit.summary().unwrap_or("").to_string(),
        parent_hashes: commit.parent_ids().map(|parent| parent.to_string()).collect(),
        refs: refs_by_oid.get(&commit.id()).cloned().unwrap_or_default(),
        files_changed,
        additions,
        deletions,
    })
}

fn revwalk_commits_from_reference(
    repo: &Repository,
    reference_name: &str,
    offset: usize,
    limit: usize,
    with_stats: bool,
) -> Result<Vec<GitCommit>> {
    let refs_by_oid = collect_commit_refs(repo)?;
    let reference = repo.find_reference(reference_name)?;
    let Some(target) = reference.target() else {
        return Ok(Vec::new());
    };

    let mut revwalk = repo.revwalk()?;
    revwalk.push(target)?;
    revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .unwrap_or(());

    let mut commits = Vec::new();
    let mut skipped = 0usize;
    for id in revwalk {
        let oid = id?;
        let commit = repo.find_commit(oid)?;
        if skipped < offset {
            skipped += 1;
            continue;
        }
        commits.push(build_git_commit(repo, &commit, &refs_by_oid, with_stats)?);

        if commits.len() >= limit {
            break;
        }
    }

    Ok(commits)
}

#[tauri::command]
pub fn get_git_repository_summary(project_path: String) -> Result<GitRepositorySummary> {
    let repo = Repository::open(&project_path)?;
    let head = repo.head()?;
    let head_hash = head.target().map(|oid| oid.to_string()).unwrap_or_default();
    let branch_name = head
        .shorthand()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "DETACHED".to_string());

    let repository_name = Path::new(&project_path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| project_path.clone());

    let last_commit_message = head
        .peel_to_commit()
        .ok()
        .and_then(|commit| commit.summary().map(|value| value.to_string()))
        .unwrap_or_default();

    let mut status_opts = StatusOptions::new();
    status_opts
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut status_opts))?;
    let mut staged_changes = 0;
    let mut unstaged_changes = 0;
    let mut untracked_files = 0;

    for entry in statuses.iter() {
        let status = entry.status();
        if has_index_status(status) {
            staged_changes += 1;
        }
        if status.is_wt_new() {
            untracked_files += 1;
        } else if has_worktree_status(status) {
            unstaged_changes += 1;
        }
    }

    Ok(GitRepositorySummary {
        repository_name,
        branch_name,
        head_hash,
        last_commit_message,
        staged_changes,
        unstaged_changes,
        untracked_files,
        is_dirty: staged_changes > 0 || unstaged_changes > 0 || untracked_files > 0,
    })
}

#[tauri::command]
pub fn list_git_branches(project_path: String) -> Result<Vec<GitBranchRef>> {
    let repo = Repository::open(&project_path)?;
    let head_name = repo
        .head()
        .ok()
        .and_then(|head| head.name().map(|value| value.to_string()));

    let mut branches = Vec::new();
    for branch_type in [BranchType::Local, BranchType::Remote] {
        let branch_iter = repo.branches(Some(branch_type))?;
        for branch_result in branch_iter {
            let (branch, actual_type) = branch_result?;
            let Some(reference_name) = branch.get().name().map(|value| value.to_string()) else {
                continue;
            };
            let short_name = branch
                .name()?
                .map(|value| value.to_string())
                .unwrap_or_else(|| reference_name.clone());

            let last_commit = branch.get().peel_to_commit().ok();
            let (ahead, behind) = branch
                .upstream()
                .ok()
                .and_then(|upstream| {
                    let local_oid = branch.get().target()?;
                    let upstream_oid = upstream.get().target()?;
                    repo.graph_ahead_behind(local_oid, upstream_oid).ok()
                })
                .unwrap_or((0, 0));

            branches.push(GitBranchRef {
                name: reference_name.clone(),
                short_name,
                branch_type: branch_type_label(actual_type).to_string(),
                is_current: head_name.as_deref() == Some(reference_name.as_str()),
                upstream_name: branch
                    .upstream()
                    .ok()
                    .and_then(|upstream| upstream.name().ok().flatten().map(|value| value.to_string())),
                ahead,
                behind,
                last_commit_hash: last_commit
                    .as_ref()
                    .map(|commit| commit.id().to_string())
                    .unwrap_or_default(),
                last_commit_date: last_commit
                    .as_ref()
                    .map(|commit| format_timestamp(commit.time().seconds()))
                    .unwrap_or_default(),
                last_commit_message: last_commit
                    .as_ref()
                    .and_then(|commit| commit.summary().map(|value| value.to_string()))
                    .unwrap_or_default(),
            });
        }
    }

    branches.sort_by(|left, right| {
        right
            .is_current
            .cmp(&left.is_current)
            .then_with(|| left.branch_type.cmp(&right.branch_type))
            .then_with(|| left.short_name.cmp(&right.short_name))
    });

    Ok(branches)
}

#[tauri::command]
pub fn checkout_git_branch(
    project_path: String,
    branch_name: String,
    branch_type: String,
) -> Result<GitRepositorySummary> {
    let repo = Repository::open(&project_path)?;
    let branch_type = parse_branch_type(&branch_type);
    let branch = repo.find_branch(&branch_name, branch_type)?;

    let local_branch_name = if branch_type == BranchType::Remote {
        branch_name
            .split_once('/')
            .map(|(_, remainder)| remainder.to_string())
            .unwrap_or(branch_name.clone())
    } else {
        branch_name.clone()
    };

    let reference_name = format!("refs/heads/{local_branch_name}");
    if branch_type == BranchType::Remote && repo.find_reference(&reference_name).is_err() {
        let commit = branch.get().peel_to_commit()?;
        repo.branch(&local_branch_name, &commit, false)?;
    }

    repo.set_head(&reference_name)?;
    let mut checkout = CheckoutBuilder::new();
    checkout.safe();
    repo.checkout_head(Some(&mut checkout))?;

    get_git_repository_summary(project_path)
}

#[tauri::command]
pub fn get_git_commits(project_path: String) -> Result<Vec<GitCommit>> {
    let repo = Repository::open(&project_path)?;
    let refs_by_oid = collect_commit_refs(&repo)?;
    let mut revwalk = repo.revwalk()?;

    if revwalk.push_head().is_err() {
        return Ok(Vec::new());
    }

    revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .unwrap_or(());

    let mut commits = Vec::new();

    for id in revwalk {
        let oid = id?;
        let commit = repo.find_commit(oid)?;

        commits.push(build_git_commit(&repo, &commit, &refs_by_oid, false)?);

        if commits.len() >= 50 {
            break;
        }
    }

    Ok(commits)
}

#[tauri::command]
pub fn get_git_branch_commits(
    project_path: String,
    branch_name: String,
    branch_type: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<Vec<GitCommit>> {
    let repo = Repository::open(&project_path)?;
    let branch_type = parse_branch_type(&branch_type);
    let branch = repo.find_branch(&branch_name, branch_type)?;
    let Some(reference_name) = branch.get().name() else {
        return Ok(Vec::new());
    };

    revwalk_commits_from_reference(
        &repo,
        reference_name,
        offset.unwrap_or(0),
        limit.unwrap_or(80).clamp(1, 300),
        false,
    )
}

#[tauri::command]
pub fn get_git_commit_details(project_path: String, hash: String) -> Result<GitCommitDetails> {
    let repo = Repository::open(&project_path)?;
    let oid = Oid::from_str(&hash)?;
    let commit = repo.find_commit(oid)?;
    let commit_tree = commit.tree()?;
    let parent_hashes = commit.parent_ids().map(|parent| parent.to_string()).collect();

    let parent_tree = commit.parents().next().map(|parent| parent.tree()).transpose()?;
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit_tree), None)?;

    let changed_files = diff
        .deltas()
        .map(|delta| {
            let old_file = delta.old_file();
            let new_file = delta.new_file();
            let path = new_file
                .path()
                .or(old_file.path())
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default();

            GitCommitChange {
                path,
                status: delta_status_label(delta.status()).to_string(),
                old_path: if delta.status() == Delta::Renamed {
                    old_file.path().map(|value| value.to_string_lossy().to_string())
                } else {
                    None
                },
            }
        })
        .collect();

    Ok(GitCommitDetails {
        hash: commit.id().to_string(),
        author: commit.author().name().unwrap_or("Unknown").to_string(),
        email: commit.author().email().unwrap_or("").to_string(),
        date: format_timestamp(commit.time().seconds()),
        summary: commit.summary().unwrap_or("").to_string(),
        message: commit.message().unwrap_or("").trim().to_string(),
        parent_hashes,
        changed_files,
    })
}

fn read_blob_content(repo: &Repository, id: git2::Oid, max_size: usize) -> (String, bool, bool) {
    if id.is_zero() {
        return (String::new(), false, false);
    }

    match repo.find_blob(id) {
        Ok(blob) => {
            let is_binary = blob.is_binary();
            let is_large = blob.size() > max_size;

            let content = if is_binary {
                "[Binary File Omitted]".to_string()
            } else if is_large {
                format!("[File Too Large: {} bytes]", blob.size())
            } else {
                String::from_utf8_lossy(blob.content()).to_string()
            };

            (content, is_binary, is_large)
        }
        Err(_) => (String::new(), false, false),
    }
}

fn read_file_content(full_path: &Path, max_size: usize) -> (String, bool, bool) {
    if let Ok(meta) = std::fs::metadata(full_path) {
        if meta.len() > max_size as u64 {
            return (
                format!("[File Too Large: {} bytes]", meta.len()),
                false,
                true,
            );
        }
    }

    match std::fs::read(full_path) {
        Ok(bytes) => {
            let is_binary = bytes.iter().take(8000).any(|&b| b == 0);
            if is_binary {
                return ("[Binary File in Workdir]".to_string(), true, false);
            }

            let content_cow = String::from_utf8_lossy(&bytes);
            let content = if content_cow.contains('\r') {
                content_cow.replace("\r\n", "\n")
            } else {
                content_cow.into_owned()
            };

            (content, false, false)
        }
        Err(_) => ("Error reading file from disk".to_string(), false, false),
    }
}

#[tauri::command]
pub fn get_git_diff(
    project_path: String,
    old_hash: String,
    new_hash: String,
) -> Result<Vec<GitDiffFile>> {
    let repo = Repository::open(&project_path)?;
    let old_tree = if old_hash == "__EMPTY_TREE__" {
        None
    } else {
        let old_oid = Oid::from_str(&old_hash)?;
        let old_commit = repo.find_commit(old_oid)?;
        Some(old_commit.tree()?)
    };

    let mut diff_opts = DiffOptions::new();
    diff_opts.include_untracked(true);

    let diff = if new_hash == "__WORK_DIR__" {
        repo.diff_tree_to_workdir_with_index(old_tree.as_ref(), Some(&mut diff_opts))?
    } else {
        let new_tree = if new_hash == "__EMPTY_TREE__" {
            None
        } else {
            let new_oid = Oid::from_str(&new_hash)?;
            let new_commit = repo.find_commit(new_oid)?;
            Some(new_commit.tree()?)
        };
        repo.diff_tree_to_tree(old_tree.as_ref(), new_tree.as_ref(), Some(&mut diff_opts))?
    };

    let diff_items: Vec<DiffItem> = diff
        .deltas()
        .map(|delta| {
            let old_file = delta.old_file();
            let new_file = delta.new_file();
            let file_path_rel = new_file.path().or(old_file.path()).unwrap();

            DiffItem {
                path: file_path_rel.to_string_lossy().to_string(),
                status: delta_status_label(delta.status()).to_string(),
                old_path: if delta.status() == Delta::Renamed {
                    Some(old_file.path().unwrap().to_string_lossy().to_string())
                } else {
                    None
                },
                old_oid: old_file.id(),
                new_oid: new_file.id(),
                delta_status: delta.status(),
            }
        })
        .collect();

    const MAX_SIZE: usize = 2 * 1024 * 1024;
    let is_workdir_mode = new_hash == "__WORK_DIR__";

    let files: Vec<GitDiffFile> = diff_items
        .into_par_iter()
        .map_init(
            || Repository::open(&project_path).ok(),
            |local_repo, item| {
                let repo_ref = local_repo.as_ref();

                let (original_content, old_binary, old_large) = if let Some(r) = repo_ref {
                    read_blob_content(r, item.old_oid, MAX_SIZE)
                } else {
                    (String::new(), false, false)
                };

                let (modified_content, new_binary, new_large) = if is_workdir_mode {
                    if item.delta_status == Delta::Deleted {
                        (String::new(), false, false)
                    } else {
                        let full_path = Path::new(&project_path).join(&item.path);
                        read_file_content(&full_path, MAX_SIZE)
                    }
                } else {
                    if let Some(r) = repo_ref {
                        read_blob_content(r, item.new_oid, MAX_SIZE)
                    } else {
                        (String::new(), false, false)
                    }
                };

                GitDiffFile {
                    path: item.path,
                    status: item.status,
                    old_path: item.old_path,
                    original_content,
                    modified_content,
                    is_binary: old_binary || new_binary,
                    is_large: old_large || new_large,
                }
            },
        )
        .collect();

    Ok(files)
}

#[tauri::command]
pub fn get_git_diff_text(
    project_path: String,
    old_hash: String,
    new_hash: String,
) -> Result<String> {
    let repo = Repository::open(&project_path)?;
    let old_tree = if old_hash == "__EMPTY_TREE__" {
        None
    } else {
        let old_oid = Oid::from_str(&old_hash)?;
        Some(repo.find_commit(old_oid).and_then(|c| c.tree())?)
    };
    let new_tree = if new_hash == "__EMPTY_TREE__" {
        None
    } else {
        let new_oid = Oid::from_str(&new_hash)?;
        Some(repo.find_commit(new_oid).and_then(|c| c.tree())?)
    };

    let diff = repo.diff_tree_to_tree(old_tree.as_ref(), new_tree.as_ref(), None)?;

    let mut diff_buf = Vec::new();
    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        match origin {
            '+' | '-' | ' ' => {
                diff_buf.push(origin as u8);
                diff_buf.extend_from_slice(line.content());
            }
            _ => {
                diff_buf.extend_from_slice(line.content());
            }
        }
        true
    })?;

    Ok(String::from_utf8_lossy(&diff_buf).to_string())
}

#[tauri::command]
pub async fn export_git_diff(
    project_path: String,
    old_hash: String,
    new_hash: String,
    format: ExportFormat,
    layout: ExportLayout,
    save_path: String,
    selected_paths: Vec<String>,
) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let all_files = get_git_diff(project_path, old_hash, new_hash)?;
        let selected_path_set: HashSet<&str> = selected_paths.iter().map(String::as_str).collect();

        let filtered_files: Vec<GitDiffFile> = all_files
            .into_iter()
            .filter(|f| selected_path_set.contains(f.path.as_str()))
            .collect();

        if filtered_files.is_empty() {
            return Err(GitError::NoFilesSelected);
        }

        let content = generate_export_content(filtered_files, format, layout);
        std::fs::write(&save_path, content)?;

        Ok(())
    })
    .await
    .map_err(|e| GitError::JoinError(e.to_string()))?
}
