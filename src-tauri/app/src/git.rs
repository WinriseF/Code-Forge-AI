use chrono::{DateTime, Local};
use git2::{Delta, DiffFormat, DiffOptions, Oid, Repository};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitCommit {
    pub hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitDiffFile {
    pub path: String,
    pub status: String,
    pub old_path: Option<String>,
    pub original_content: String,
    pub modified_content: String,
    pub is_binary: bool,
    pub is_large: bool,
}

struct DiffItem {
    path: String,
    status: String,
    old_path: Option<String>,
    old_oid: Oid,
    new_oid: Oid,
    delta_status: Delta,
}

#[tauri::command]
pub fn get_git_commits(project_path: String) -> Result<Vec<GitCommit>, String> {
    let repo = Repository::open(&project_path).map_err(|e| format!("无法打开 Git 仓库: {}", e))?;

    let mut revwalk = repo
        .revwalk()
        .map_err(|e| format!("无法读取历史记录: {}", e))?;

    if revwalk.push_head().is_err() {
        return Ok(Vec::new());
    }

    revwalk.set_sorting(git2::Sort::TIME).unwrap_or(());

    let mut commits = Vec::new();

    for id in revwalk {
        let oid = id.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;

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
) -> Result<Vec<GitDiffFile>, String> {
    let repo = Repository::open(&project_path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let old_oid = Oid::from_str(&old_hash).map_err(|e| format!("Invalid old hash: {}", e))?;
    let old_commit = repo.find_commit(old_oid).map_err(|e| e.to_string())?;
    let old_tree = old_commit.tree().map_err(|e| e.to_string())?;

    let mut diff_opts = DiffOptions::new();
    diff_opts.include_untracked(true);

    let diff = if new_hash == "__WORK_DIR__" {
        repo.diff_tree_to_workdir_with_index(Some(&old_tree), Some(&mut diff_opts))
            .map_err(|e| format!("Workdir diff failed: {}", e))?
    } else {
        let new_oid = Oid::from_str(&new_hash).map_err(|e| format!("Invalid new hash: {}", e))?;
        let new_commit = repo.find_commit(new_oid).map_err(|e| e.to_string())?;
        let new_tree = new_commit.tree().map_err(|e| e.to_string())?;

        repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), Some(&mut diff_opts))
            .map_err(|e| format!("Tree diff failed: {}", e))?
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
        .map(|item| {
            let local_repo = Repository::open(&project_path).ok();

            let (original_content, old_binary, old_large) = if let Some(r) = &local_repo {
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
                if let Some(r) = &local_repo {
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
        })
        .collect();

    Ok(files)
}

#[tauri::command]
pub fn get_git_diff_text(
    project_path: String,
    old_hash: String,
    new_hash: String,
) -> Result<String, String> {
    let repo = Repository::open(&project_path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let old_oid = Oid::from_str(&old_hash).map_err(|e| e.to_string())?;
    let new_oid = Oid::from_str(&new_hash).map_err(|e| e.to_string())?;

    let old_tree = repo
        .find_commit(old_oid)
        .and_then(|c| c.tree())
        .map_err(|e| e.to_string())?;
    let new_tree = repo
        .find_commit(new_oid)
        .and_then(|c| c.tree())
        .map_err(|e| e.to_string())?;

    let diff = repo
        .diff_tree_to_tree(Some(&old_tree), Some(&new_tree), None)
        .map_err(|e| e.to_string())?;

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
    })
    .map_err(|e| format!("Failed to print diff: {}", e))?;

    Ok(String::from_utf8_lossy(&diff_buf).to_string())
}
