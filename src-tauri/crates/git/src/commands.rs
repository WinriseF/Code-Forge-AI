use crate::error::{GitError, Result};
use crate::export::generate_export_content;
use crate::models::{ExportFormat, ExportLayout, GitCommit, GitDiffFile, GitRef, GitRefKind, GraphCommit};
use chrono::{DateTime, Local};
use git2::{Delta, DiffFormat, DiffOptions, Oid, Repository};
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
) -> Result<Vec<GitDiffFile>> {
    let repo = Repository::open(&project_path)?;
    let old_oid = Oid::from_str(&old_hash)?;
    let old_commit = repo.find_commit(old_oid)?;
    let old_tree = old_commit.tree()?;

    let mut diff_opts = DiffOptions::new();
    diff_opts.include_untracked(true);

    let diff = if new_hash == "__WORK_DIR__" {
        repo.diff_tree_to_workdir_with_index(Some(&old_tree), Some(&mut diff_opts))?
    } else {
        let new_oid = Oid::from_str(&new_hash)?;
        let new_commit = repo.find_commit(new_oid)?;
        let new_tree = new_commit.tree()?;
        repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), Some(&mut diff_opts))?
    };

    let diff_items: Vec<DiffItem> = diff
        .deltas()
        .map(|delta| {
            let old_file = delta.old_file();
            let new_file = delta.new_file();
            let file_path_rel = new_file.path().or(old_file.path()).unwrap();

            let status = match delta.status() {
                Delta::Added => "Added",
                Delta::Deleted => "Deleted",
                Delta::Modified => "Modified",
                Delta::Renamed => "Renamed",
                _ => "Modified",
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
                } else if let Some(r) = repo_ref {
                    read_blob_content(r, item.new_oid, MAX_SIZE)
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
    let old_oid = Oid::from_str(&old_hash)?;
    let new_oid = Oid::from_str(&new_hash)?;

    let old_tree = repo.find_commit(old_oid).and_then(|c| c.tree())?;
    let new_tree = repo.find_commit(new_oid).and_then(|c| c.tree())?;

    let diff = repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), None)?;

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

#[tauri::command]
pub fn get_git_log_graph(
    project_path: String,
    limit: Option<usize>,
    skip: Option<usize>,
) -> Result<Vec<GraphCommit>> {
    let limit = limit.unwrap_or(300);
    let skip = skip.unwrap_or(0);
    let repo = Repository::open(&project_path)?;

    // Build ref map: target OID -> list of (name, kind)
    let mut ref_map: HashMap<Oid, Vec<GitRef>> = HashMap::new();

    // HEAD
    if let Ok(head) = repo.head()
        && let Ok(target_oid) = head.target().ok_or_else(|| git2::Error::from_str("no target"))
    {
        let branch_name = head.shorthand().unwrap_or("HEAD");
        ref_map.entry(target_oid).or_default().push(GitRef {
            name: branch_name.to_string(),
            kind: GitRefKind::Head,
        });
    }

    // All references
    if let Ok(references) = repo.references() {
        for reference in references.flatten() {
            if let Some(target_oid) = reference.target() {
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

                ref_map.entry(target_oid).or_default().push(GitRef { name, kind });
            }
        }
    }

    // Walk commits
    let mut revwalk = repo.revwalk()?;
    if revwalk.push_head().is_err() {
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

        let refs = ref_map.remove(&oid).unwrap_or_default();

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
