use base64::{Engine as _, engine::general_purpose};
use flate2::read::GzDecoder;
use serde::Serialize;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

const MAX_ARCHIVE_ENTRIES: usize = 5_000;
const MAX_ENTRY_PREVIEW_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArchiveFormat {
    Zip,
    Tar,
    TarGz,
    Gzip,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub index: usize,
    pub path: String,
    pub name: String,
    pub size: Option<u64>,
    pub compressed_size: Option<u64>,
    pub is_dir: bool,
    pub is_safe_path: bool,
    pub previewable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveListing {
    pub format: String,
    pub entries: Vec<ArchiveEntry>,
    pub total_size: u64,
    pub total_compressed_size: Option<u64>,
    pub truncated: bool,
    pub max_preview_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntryPreview {
    pub entry: ArchiveEntry,
    pub kind: String,
    pub mime: String,
    pub language: Option<String>,
    pub text: Option<String>,
    pub data_url: Option<String>,
    pub message: Option<String>,
}

pub fn list_archive_entries(path_str: &str) -> crate::error::Result<ArchiveListing> {
    let path = Path::new(path_str);
    let format = detect_archive_format(path)
        .ok_or_else(|| "Archive format is not supported for preview yet".to_string())?;

    match format {
        ArchiveFormat::Zip => list_zip_entries(path),
        ArchiveFormat::Tar => list_tar_entries(path, false),
        ArchiveFormat::TarGz => list_tar_entries(path, true),
        ArchiveFormat::Gzip => list_gzip_entry(path),
    }
}

pub fn preview_archive_entry(
    path_str: &str,
    entry_index: usize,
) -> crate::error::Result<ArchiveEntryPreview> {
    let path = Path::new(path_str);
    let format = detect_archive_format(path)
        .ok_or_else(|| "Archive format is not supported for preview yet".to_string())?;

    let (entry, bytes) = match format {
        ArchiveFormat::Zip => read_zip_entry(path, entry_index)?,
        ArchiveFormat::Tar => read_tar_entry(path, entry_index, false)?,
        ArchiveFormat::TarGz => read_tar_entry(path, entry_index, true)?,
        ArchiveFormat::Gzip => read_gzip_entry(path, entry_index)?,
    };

    build_entry_preview(entry, bytes)
}

fn detect_archive_format(path: &Path) -> Option<ArchiveFormat> {
    let name = path.file_name()?.to_string_lossy().to_lowercase();
    if name.ends_with(".zip") {
        Some(ArchiveFormat::Zip)
    } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        Some(ArchiveFormat::TarGz)
    } else if name.ends_with(".tar") {
        Some(ArchiveFormat::Tar)
    } else if name.ends_with(".gz") {
        Some(ArchiveFormat::Gzip)
    } else {
        None
    }
}

fn list_zip_entries(path: &Path) -> crate::error::Result<ArchiveListing> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    let mut total_size = 0_u64;
    let mut total_compressed_size = 0_u64;
    let entry_count = archive.len();

    for index in 0..entry_count.min(MAX_ARCHIVE_ENTRIES) {
        let file = archive.by_index(index).map_err(|e| e.to_string())?;
        let size = file.size();
        let compressed_size = file.compressed_size();
        total_size = total_size.saturating_add(size);
        total_compressed_size = total_compressed_size.saturating_add(compressed_size);

        entries.push(build_entry(
            index,
            file.name(),
            Some(size),
            Some(compressed_size),
            file.is_dir(),
        ));
    }

    Ok(ArchiveListing {
        format: "zip".to_string(),
        entries,
        total_size,
        total_compressed_size: Some(total_compressed_size),
        truncated: entry_count > MAX_ARCHIVE_ENTRIES,
        max_preview_bytes: MAX_ENTRY_PREVIEW_BYTES,
    })
}

fn list_gzip_entry(path: &Path) -> crate::error::Result<ArchiveListing> {
    let compressed_size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    let entry_name = gzip_entry_name(path);
    let entry = build_entry(0, &entry_name, None, Some(compressed_size), false);

    Ok(ArchiveListing {
        format: "gzip".to_string(),
        entries: vec![entry],
        total_size: 0,
        total_compressed_size: Some(compressed_size),
        truncated: false,
        max_preview_bytes: MAX_ENTRY_PREVIEW_BYTES,
    })
}

fn list_tar_entries(path: &Path, gzip: bool) -> crate::error::Result<ArchiveListing> {
    let reader = open_tar_reader(path, gzip)?;
    let mut archive = tar::Archive::new(reader);
    let entries = archive.entries().map_err(|e| e.to_string())?;
    let mut listing_entries = Vec::new();
    let mut total_size = 0_u64;
    let mut truncated = false;

    for (index, entry_result) in entries.enumerate() {
        if index >= MAX_ARCHIVE_ENTRIES {
            truncated = true;
            break;
        }

        let entry = entry_result.map_err(|e| e.to_string())?;
        let path = entry
            .path()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();
        let size = entry.header().size().ok();
        if let Some(size) = size {
            total_size = total_size.saturating_add(size);
        }
        let is_dir = entry.header().entry_type().is_dir();

        listing_entries.push(build_entry(index, &path, size, None, is_dir));
    }

    Ok(ArchiveListing {
        format: if gzip { "tar.gz" } else { "tar" }.to_string(),
        entries: listing_entries,
        total_size,
        total_compressed_size: None,
        truncated,
        max_preview_bytes: MAX_ENTRY_PREVIEW_BYTES,
    })
}

fn read_zip_entry(path: &Path, entry_index: usize) -> crate::error::Result<(ArchiveEntry, Vec<u8>)> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut file = archive.by_index(entry_index).map_err(|e| e.to_string())?;
    let entry = build_entry(
        entry_index,
        file.name(),
        Some(file.size()),
        Some(file.compressed_size()),
        file.is_dir(),
    );

    read_entry_bytes(entry, &mut file)
}

fn read_gzip_entry(
    path: &Path,
    entry_index: usize,
) -> crate::error::Result<(ArchiveEntry, Vec<u8>)> {
    if entry_index != 0 {
        return Err("Archive entry was not found".to_string());
    }

    let compressed_size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    let entry_name = gzip_entry_name(path);
    let entry = build_entry(0, &entry_name, None, Some(compressed_size), false);
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut decoder = GzDecoder::new(BufReader::new(file));

    read_entry_bytes(entry, &mut decoder)
}

fn read_tar_entry(
    path: &Path,
    entry_index: usize,
    gzip: bool,
) -> crate::error::Result<(ArchiveEntry, Vec<u8>)> {
    let reader = open_tar_reader(path, gzip)?;
    let mut archive = tar::Archive::new(reader);
    let entries = archive.entries().map_err(|e| e.to_string())?;

    for (index, entry_result) in entries.enumerate() {
        let mut entry = entry_result.map_err(|e| e.to_string())?;
        if index != entry_index {
            continue;
        }

        let path = entry
            .path()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();
        let size = entry.header().size().ok();
        let is_dir = entry.header().entry_type().is_dir();
        let archive_entry = build_entry(index, &path, size, None, is_dir);

        return read_entry_bytes(archive_entry, &mut entry);
    }

    Err("Archive entry was not found".to_string())
}

fn open_tar_reader(path: &Path, gzip: bool) -> crate::error::Result<Box<dyn Read>> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    if gzip {
        Ok(Box::new(GzDecoder::new(reader)))
    } else {
        Ok(Box::new(reader))
    }
}

fn read_entry_bytes<R: Read>(
    entry: ArchiveEntry,
    reader: &mut R,
) -> crate::error::Result<(ArchiveEntry, Vec<u8>)> {
    if entry.is_dir {
        return Err("Directories cannot be previewed".to_string());
    }

    if !entry.is_safe_path {
        return Err("Archive entry path is unsafe".to_string());
    }

    if let Some(size) = entry.size {
        if size > MAX_ENTRY_PREVIEW_BYTES {
            return Err(format!(
                "Archive entry is larger than {} bytes",
                MAX_ENTRY_PREVIEW_BYTES
            ));
        }
    }

    let mut limited = reader.take(MAX_ENTRY_PREVIEW_BYTES + 1);
    let mut bytes = Vec::new();
    limited.read_to_end(&mut bytes).map_err(|e| e.to_string())?;

    if bytes.len() as u64 > MAX_ENTRY_PREVIEW_BYTES {
        return Err(format!(
            "Archive entry is larger than {} bytes",
            MAX_ENTRY_PREVIEW_BYTES
        ));
    }

    Ok((entry, bytes))
}

fn build_entry(
    index: usize,
    raw_path: &str,
    size: Option<u64>,
    compressed_size: Option<u64>,
    is_dir: bool,
) -> ArchiveEntry {
    let path = normalize_archive_path(raw_path);
    let is_safe_path = is_safe_archive_path(&path);
    let previewable = !is_dir && is_safe_path && size.is_none_or(|size| size <= MAX_ENTRY_PREVIEW_BYTES);
    let name = entry_name(&path);

    ArchiveEntry {
        index,
        path,
        name,
        size,
        compressed_size,
        is_dir,
        is_safe_path,
        previewable,
    }
}

fn normalize_archive_path(path: &str) -> String {
    path.replace('\\', "/")
        .trim_start_matches("./")
        .trim_end_matches('/')
        .to_string()
}

fn entry_name(path: &str) -> String {
    path.rsplit('/')
        .find(|part| !part.is_empty())
        .unwrap_or(path)
        .to_string()
}

fn gzip_entry_name(path: &Path) -> String {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "content.gz".to_string());

    let name = file_name
        .strip_suffix(".gz")
        .filter(|name| !name.is_empty())
        .unwrap_or(&file_name);

    name.to_string()
}

fn is_safe_archive_path(path: &str) -> bool {
    if path.is_empty()
        || path.contains('\0')
        || path.starts_with('/')
        || path.starts_with('~')
        || path.contains(':')
    {
        return false;
    }

    path.split('/').all(|part| {
        !part.is_empty() && part != "." && part != ".." && !part.chars().any(char::is_control)
    })
}

fn build_entry_preview(
    entry: ArchiveEntry,
    bytes: Vec<u8>,
) -> crate::error::Result<ArchiveEntryPreview> {
    let mime = detect_entry_mime(&entry.path, &bytes);

    if mime.starts_with("image/") {
        let data_url = format!(
            "data:{};base64,{}",
            mime,
            general_purpose::STANDARD.encode(&bytes)
        );

        return Ok(ArchiveEntryPreview {
            entry,
            kind: "image".to_string(),
            mime,
            language: None,
            text: None,
            data_url: Some(data_url),
            message: None,
        });
    }

    match String::from_utf8(bytes) {
        Ok(text) => {
            let language = entry_language(&entry.path);
            Ok(ArchiveEntryPreview {
                entry,
                kind: "text".to_string(),
                mime,
                language,
                text: Some(text),
                data_url: None,
                message: None,
            })
        }
        Err(_) => Ok(ArchiveEntryPreview {
            entry,
            kind: "unsupported".to_string(),
            mime,
            language: None,
            text: None,
            data_url: None,
            message: Some("This archive entry is not a supported text or image preview.".to_string()),
        }),
    }
}

fn detect_entry_mime(path: &str, bytes: &[u8]) -> String {
    if let Some(kind) = infer::get(bytes) {
        return kind.mime_type().to_string();
    }

    mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string()
}

fn entry_language(path: &str) -> Option<String> {
    let ext = Path::new(path)
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())?;

    let language = match ext.as_str() {
        "md" | "markdown" => "markdown",
        "htm" | "html" => "html",
        "json" => "json",
        "xml" => "xml",
        "yml" | "yaml" => "yaml",
        "toml" => "toml",
        "rs" => "rust",
        "js" | "jsx" => "javascript",
        "ts" | "tsx" => "typescript",
        "css" => "css",
        "py" => "python",
        "java" => "java",
        "c" => "c",
        "cpp" | "cc" | "cxx" => "cpp",
        "h" | "hpp" => "cpp",
        "sql" => "sql",
        "sh" => "shell",
        "ps1" => "powershell",
        "bat" | "cmd" => "bat",
        "ini" | "conf" => "ini",
        "csv" | "tsv" | "txt" | "log" => "plaintext",
        _ => "plaintext",
    };

    Some(language.to_string())
}
