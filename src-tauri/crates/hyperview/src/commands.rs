use crate::{
    archive::{ArchiveEntryPreview, ArchiveListing},
    sniffer::FileMeta,
};

#[tauri::command]
pub async fn get_file_meta(path: String) -> crate::error::Result<FileMeta> {
    tauri::async_runtime::spawn_blocking(move || crate::sniffer::detect_file_type(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_archive_entries(path: String) -> crate::error::Result<ArchiveListing> {
    tauri::async_runtime::spawn_blocking(move || crate::archive::list_archive_entries(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn preview_archive_entry(
    path: String,
    entry_index: usize,
) -> crate::error::Result<ArchiveEntryPreview> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::archive::preview_archive_entry(&path, entry_index)
    })
    .await
    .map_err(|e| e.to_string())?
}
