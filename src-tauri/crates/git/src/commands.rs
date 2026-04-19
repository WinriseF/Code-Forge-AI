use crate::error::{GitError, Result};
use crate::export::generate_export_content;
use crate::models::{
    ExportFormat, ExportLayout, GitCommit, GitDiffFile, GitDiffResponse, GitDiffSummary, GitRef,
    GitRefKind, GraphCommit,
};
use chrono::{DateTime, Local};
use git2::{Delta, DiffFormat, DiffOptions, Oid, Reference, Repository};
use rayon::prelude::*;
use std::cell::RefCell;
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

#[derive(Clone, Copy, Default)]
struct FileLineStats {
    additions: usize,
    deletions: usize,
}

fn add_git_ref(ref_map: &mut HashMap<Oid, Vec<GitRef>>, oid: Oid, git_ref: GitRef) {
    let refs = ref_map.entry(oid).or_default();
    if refs
        .iter()
        .any(|existing| existing.name == git_ref.name && existing.kind == git_ref.kind)
    {
        return;
    }

    refs.push(git_ref);
}

fn git_ref_priority(kind: &GitRefKind) -> u8 {
    match kind {
        GitRefKind::Head => 0,
        GitRefKind::Branch => 1,
        GitRefKind::DeletedBranch => 2,
        GitRefKind::Tag => 3,
        GitRefKind::Stash => 4,
        GitRefKind::RemoteBranch => 5,
    }
}

fn sort_git_refs(refs: &mut Vec<GitRef>) {
    refs.sort_by(|left, right| {
        git_ref_priority(&left.kind)
            .cmp(&git_ref_priority(&right.kind))
            .then_with(|| left.name.cmp(&right.name))
    });
}

fn is_hex_like_ref_name(name: &str) -> bool {
    let trimmed = name.trim();
    (7..=40).contains(&trimmed.len()) && trimmed.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn is_probable_branch_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "HEAD"
        || trimmed.starts_with('(')
        || trimmed.contains("detached")
        || is_hex_like_ref_name(trimmed)
    {
        return false;
    }

    !trimmed
        .chars()
        .any(|ch| matches!(ch, ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\'))
}

fn parse_checkout_reflog_message(message: &str) -> Option<(&str, &str)> {
    let prefix = "checkout: moving from ";
    let rest = message.strip_prefix(prefix)?;
    let (from, to) = rest.split_once(" to ")?;
    Some((from.trim(), to.trim()))
}

fn add_deleted_branch_hint(
    repo: &Repository,
    live_ref_names: &HashSet<String>,
    seen_deleted_branches: &mut HashSet<String>,
    ref_map: &mut HashMap<Oid, Vec<GitRef>>,
    root_oids: &mut HashSet<Oid>,
    branch_name: &str,
    oid: Oid,
) {
    let branch_name = branch_name.trim();
    if oid.is_zero()
        || !is_probable_branch_name(branch_name)
        || live_ref_names.contains(branch_name)
        || seen_deleted_branches.contains(branch_name)
        || repo.find_commit(oid).is_err()
    {
        return;
    }

    seen_deleted_branches.insert(branch_name.to_string());
    root_oids.insert(oid);
    add_git_ref(
        ref_map,
        oid,
        GitRef {
            name: branch_name.to_string(),
            kind: GitRefKind::DeletedBranch,
        },
    );
}

fn collect_diff_line_stats(diff: &git2::Diff<'_>) -> Result<HashMap<String, FileLineStats>> {
    let line_stats_by_path: RefCell<HashMap<String, FileLineStats>> = RefCell::new(HashMap::new());
    let current_path = RefCell::new(String::new());

    diff.foreach(
        &mut |delta, _progress| {
            let path = delta.new_file().path().or(delta.old_file().path());
            let mut current_path_ref = current_path.borrow_mut();
            current_path_ref.clear();
            if let Some(path) = path {
                current_path_ref.push_str(&path.to_string_lossy());
                line_stats_by_path
                    .borrow_mut()
                    .entry(current_path_ref.clone())
                    .or_default();
            }
            true
        },
        None,
        None,
        Some(&mut |_delta, _hunk, line| {
            let current_path_ref = current_path.borrow();
            if current_path_ref.is_empty() {
                return true;
            }

            if let Some(stats) = line_stats_by_path.borrow_mut().get_mut(current_path_ref.as_str()) {
                match line.origin() {
                    '+' => stats.additions += 1,
                    '-' => stats.deletions += 1,
                    _ => {}
                }
            }

            true
        }),
    )?;

    Ok(line_stats_by_path.into_inner())
}

fn reference_target_commit_oid(reference: &Reference<'_>) -> Option<Oid> {
    reference
        .peel_to_commit()
        .ok()
        .map(|commit| commit.id())
        .or_else(|| reference.target())
}

fn build_diff_file(
    item: DiffItem,
    repo: Option<&Repository>,
    project_path: &str,
    is_workdir_mode: bool,
    max_size: usize,
    line_stats: FileLineStats,
) -> GitDiffFile {
    let (original_content, old_binary, old_large) = if let Some(r) = repo {
        read_blob_content(r, item.old_oid, max_size)
    } else {
        (String::new(), false, false)
    };

    let (modified_content, new_binary, new_large) = if is_workdir_mode {
        if item.delta_status == Delta::Deleted {
            (String::new(), false, false)
        } else {
            let full_path = Path::new(project_path).join(&item.path);
            read_file_content(&full_path, max_size)
        }
    } else if let Some(r) = repo {
        read_blob_content(r, item.new_oid, max_size)
    } else {
        (String::new(), false, false)
    };

    GitDiffFile {
        path: item.path,
        status: item.status,
        old_path: item.old_path,
        original_content,
        modified_content,
        is_binary: old_binary || new_binary,
        is_large: old_large || new_large,
        additions: line_stats.additions,
        deletions: line_stats.deletions,
    }
}

#[tauri::command]
pub fn get_git_commits(project_path: String) -> Result<Vec<GitCommit>> {
    let repo = Repository::open(&project_path)?;
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

        let time = commit.time();
        let dt = DateTime::from_timestamp(time.seconds(), 0).unwrap_or_default();
        let date_str = dt
            .with_timezone(&Local)
            .format("%Y-%m-%d %H:%M")
            .to_string();

        commits.push(GitCommit {
            hash: oid.to_string(),
            author: commit.author().name().unwrap_or("Unknown").to_string(),
            date: date_str,
            message: commit.summary().unwrap_or("").to_string(),
        });

        if commits.len() >= 50 {
            break;
        }
    }

    Ok(commits)
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
    if let Ok(meta) = std::fs::metadata(full_path)
        && meta.len() > max_size as u64
    {
        return (
            format!("[File Too Large: {} bytes]", meta.len()),
            false,
            true,
        );
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
) -> Result<GitDiffResponse> {
    let repo = Repository::open(&project_path)?;
    let old_oid = Oid::from_str(&old_hash)?;
    let old_commit = repo.find_commit(old_oid)?;
    let old_tree = old_commit.tree()?;

    let mut diff_opts = DiffOptions::new();
    diff_opts.include_untracked(true);

    let mut diff = if new_hash == "__WORK_DIR__" {
        repo.diff_tree_to_workdir_with_index(Some(&old_tree), Some(&mut diff_opts))?
    } else {
        let new_oid = Oid::from_str(&new_hash)?;
        let new_commit = repo.find_commit(new_oid)?;
        let new_tree = new_commit.tree()?;
        repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), Some(&mut diff_opts))?
    };
    diff.find_similar(None)?;

    let diff_stats = diff.stats()?;
    let line_stats = collect_diff_line_stats(&diff)?;
    let mut summary = GitDiffSummary {
        files_changed: diff_stats.files_changed(),
        files_added: 0,
        files_modified: 0,
        files_deleted: 0,
        files_renamed: 0,
        insertions: diff_stats.insertions(),
        deletions: diff_stats.deletions(),
    };

    let diff_items: Vec<DiffItem> = diff
        .deltas()
        .map(|delta| {
            let old_file = delta.old_file();
            let new_file = delta.new_file();
            let file_path_rel = new_file.path().or(old_file.path()).unwrap();

            let status = match delta.status() {
                Delta::Added | Delta::Untracked => {
                    summary.files_added += 1;
                    "Added"
                }
                Delta::Deleted => {
                    summary.files_deleted += 1;
                    "Deleted"
                }
                Delta::Modified => {
                    summary.files_modified += 1;
                    "Modified"
                }
                Delta::Renamed => {
                    summary.files_renamed += 1;
                    "Renamed"
                }
                _ => {
                    summary.files_modified += 1;
                    "Modified"
                }
            };

            DiffItem {
                path: file_path_rel.to_string_lossy().to_string(),
                status: status.to_string(),
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
    const PARALLEL_DIFF_THRESHOLD: usize = 4;
    let is_workdir_mode = new_hash == "__WORK_DIR__";

    let files: Vec<GitDiffFile> = if diff_items.len() < PARALLEL_DIFF_THRESHOLD {
        diff_items
            .into_iter()
            .map(|item| {
                let stats = line_stats.get(item.path.as_str()).copied().unwrap_or_default();
                build_diff_file(item, Some(&repo), &project_path, is_workdir_mode, MAX_SIZE, stats)
            })
            .collect()
    } else {
        diff_items
            .into_par_iter()
            .map_init(
                || Repository::open(&project_path).ok(),
                |local_repo, item| {
                    let stats = line_stats.get(item.path.as_str()).copied().unwrap_or_default();
                    build_diff_file(
                        item,
                        local_repo.as_ref(),
                        &project_path,
                        is_workdir_mode,
                        MAX_SIZE,
                        stats,
                    )
                },
            )
            .collect()
    };

    Ok(GitDiffResponse { files, summary })
}

#[tauri::command]
pub fn get_git_diff_text(
    project_path: String,
    old_hash: String,
    new_hash: String,
) -> Result<String> {
    let repo = Repository::open(&project_path)?;
    let old_oid = Oid::from_str(&old_hash)?;
    let new_oid = Oid::from_str(&new_hash)?;

    let old_tree = repo.find_commit(old_oid).and_then(|c| c.tree())?;
    let new_tree = repo.find_commit(new_oid).and_then(|c| c.tree())?;

    let mut diff = repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), None)?;
    diff.find_similar(None)?;

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
            .files
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

#[tauri::command]
pub fn get_git_log_graph(
    project_path: String,
    limit: Option<usize>,
    skip: Option<usize>,
) -> Result<Vec<GraphCommit>> {
    let limit = limit.unwrap_or(300);
    let skip = skip.unwrap_or(0);
    let mut repo = Repository::open(&project_path)?;

    // Build ref map: target OID -> list of (name, kind)
    let mut ref_map: HashMap<Oid, Vec<GitRef>> = HashMap::new();
    let mut root_oids = HashSet::new();
    let mut live_ref_names = HashSet::new();

    // HEAD
    if let Ok(head) = repo.head()
        && let Some(target_oid) = reference_target_commit_oid(&head)
    {
        let branch_name = head.shorthand().unwrap_or("HEAD");
        root_oids.insert(target_oid);
        live_ref_names.insert(branch_name.to_string());
        add_git_ref(
            &mut ref_map,
            target_oid,
            GitRef {
                name: branch_name.to_string(),
                kind: GitRefKind::Head,
            },
        );
    }

    // All references
    if let Ok(references) = repo.references() {
        for reference in references.flatten() {
            if let Some(target_oid) = reference_target_commit_oid(&reference) {
                let name = reference.shorthand().unwrap_or("").to_string();
                if name.is_empty() {
                    continue;
                }

                let kind = if reference.is_remote() {
                    GitRefKind::RemoteBranch
                } else if reference.is_tag() {
                    GitRefKind::Tag
                } else if reference.is_branch() {
                    GitRefKind::Branch
                } else {
                    continue;
                };

                // Skip if already added as HEAD
                if matches!(kind, GitRefKind::Branch) {
                    let already_head = ref_map
                        .get(&target_oid)
                        .map(|refs| refs.iter().any(|r| matches!(r.kind, GitRefKind::Head) && r.name == name))
                        .unwrap_or(false);
                    if already_head {
                        continue;
                    }
                }

                live_ref_names.insert(name.clone());
                root_oids.insert(target_oid);
                add_git_ref(&mut ref_map, target_oid, GitRef { name, kind });
            }
        }
    }

    // Stash entries are not regular live branches; enumerate them explicitly.
    let _ = repo.stash_foreach(|index, _message, stash_oid| {
        root_oids.insert(*stash_oid);
        add_git_ref(
            &mut ref_map,
            *stash_oid,
            GitRef {
                name: format!("stash@{{{index}}}"),
                kind: GitRefKind::Stash,
            },
        );
        true
    });

    // Best-effort deleted branch recovery from HEAD reflog.
    let mut seen_deleted_branches = HashSet::new();
    if let Ok(head_reflog) = repo.reflog("HEAD") {
        for entry in head_reflog.iter().take(400) {
            let Some(message) = entry.message() else {
                continue;
            };
            let Some((from, to)) = parse_checkout_reflog_message(message) else {
                continue;
            };

            add_deleted_branch_hint(
                &repo,
                &live_ref_names,
                &mut seen_deleted_branches,
                &mut ref_map,
                &mut root_oids,
                from,
                entry.id_old(),
            );
            add_deleted_branch_hint(
                &repo,
                &live_ref_names,
                &mut seen_deleted_branches,
                &mut ref_map,
                &mut root_oids,
                to,
                entry.id_new(),
            );
        }
    }

    // Walk commits
    let mut revwalk = repo.revwalk()?;
    let mut pushed_any = false;
    for oid in root_oids {
        revwalk.push(oid)?;
        pushed_any = true;
    }
    if !pushed_any {
        return Ok(Vec::new());
    }
    revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .unwrap_or(());

    let mut commits = Vec::new();

    for (index, id) in revwalk.enumerate() {
        if index < skip {
            continue;
        }

        let oid = id?;
        let commit = repo.find_commit(oid)?;

        let time = commit.time();
        let dt = DateTime::from_timestamp(time.seconds(), 0).unwrap_or_default();
        let date_str = dt
            .with_timezone(&Local)
            .format("%Y-%m-%d %H:%M")
            .to_string();

        let parent_hashes: Vec<String> = commit.parent_ids().map(|p| p.to_string()).collect();

        let mut refs = ref_map.remove(&oid).unwrap_or_default();
        sort_git_refs(&mut refs);

        let hash = oid.to_string();
        let short_hash = if hash.len() >= 7 { hash[..7].to_string() } else { hash.clone() };

        commits.push(GraphCommit {
            hash,
            short_hash,
            author: commit.author().name().unwrap_or("Unknown").to_string(),
            date: date_str,
            message: commit.summary().unwrap_or("").to_string(),
            parent_hashes,
            refs,
        });

        if commits.len() >= limit {
            break;
        }
    }

    Ok(commits)
}
