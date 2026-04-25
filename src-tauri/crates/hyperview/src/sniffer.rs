use serde::Serialize;
use std::fs::File;
use std::io::Read;
use std::path::Path;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PreviewType {
    Image,
    Video,
    Audio,
    Code, // 源代码/纯文本
    Markdown,
    Html,
    Pdf,
    Docx,
    Archive, // Zip, Tar...
    Binary,  // 未知/二进制
    Office,  // Docx, Xlsx...
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PreviewMode {
    Default,
    Source,
    Rendered,
    Formatted,
    Table,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub preview_type: PreviewType,
    pub supported_modes: Vec<PreviewMode>,
    pub default_mode: PreviewMode,
    pub mime: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PathInspection {
    pub ext: String,
    pub preview_type: PreviewType,
    pub mime: String,
}

fn read_sniff_bytes(path: &Path) -> Option<Vec<u8>> {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return None,
    };
    let mut buffer = vec![0; 8192];
    let read_len = match file.read(&mut buffer) {
        Ok(read_len) => read_len,
        Err(_) => return None,
    };
    buffer.truncate(read_len);
    Some(buffer)
}

fn get_magic_mime(bytes: &[u8]) -> Option<&'static str> {
    infer::get(bytes).map(|kind| kind.mime_type())
}

fn is_likely_text(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }

    if bytes.contains(&0) {
        return false;
    }

    std::str::from_utf8(bytes).is_ok()
}

fn extension_from_path(path: &Path) -> String {
    path.extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn classify_by_extension(ext: &str) -> PreviewType {
    match ext {
        "md" | "markdown" => PreviewType::Markdown,
        "htm" | "html" => PreviewType::Html,
        "svg" => PreviewType::Image,
        "txt" | "json" | "rs" | "js" | "mjs" | "cjs" | "ts" | "tsx" | "mts" | "cts" | "jsx"
        | "css" | "xml" | "yml" | "yaml" | "toml" | "sql" | "py" | "java" | "c" | "cpp" | "h"
        | "sh" | "bat" | "cmd" | "ps1" | "log" | "ini" | "conf" | "csv" | "tsv" => {
            PreviewType::Code
        }
        "pdf" => PreviewType::Pdf,
        "docx" => PreviewType::Docx,
        "zip" | "tar" | "gz" | "tgz" => PreviewType::Archive,
        "doc" | "xlsx" | "xls" | "pptx" | "ppt" => PreviewType::Office,
        _ => PreviewType::Binary,
    }
}

fn preview_type_from_mime(mime: &str) -> Option<PreviewType> {
    match mime {
        "image/svg+xml" => Some(PreviewType::Image),
        "text/markdown" => Some(PreviewType::Markdown),
        "text/html" | "application/xhtml+xml" => Some(PreviewType::Html),
        "application/pdf" => Some(PreviewType::Pdf),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => {
            Some(PreviewType::Docx)
        }
        "application/zip" | "application/x-tar" | "application/gzip" | "application/x-gzip" => {
            Some(PreviewType::Archive)
        }
        "application/msword"
        | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        | "application/vnd.ms-excel"
        | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        | "application/vnd.ms-powerpoint" => Some(PreviewType::Office),
        "application/json" | "application/javascript" => Some(PreviewType::Code),
        _ if mime.starts_with("image/") => Some(PreviewType::Image),
        _ if mime.starts_with("video/") => Some(PreviewType::Video),
        _ if mime.starts_with("audio/") => Some(PreviewType::Audio),
        _ if mime.starts_with("text/") => Some(PreviewType::Code),
        _ if mime.ends_with("+json") || mime == "application/xml" || mime.ends_with("+xml") => {
            Some(PreviewType::Code)
        }
        _ => None,
    }
}

fn is_magic_override_candidate(preview_type: &PreviewType) -> bool {
    matches!(
        preview_type,
        PreviewType::Image
            | PreviewType::Video
            | PreviewType::Audio
            | PreviewType::Pdf
            | PreviewType::Archive
    )
}

fn resolve_preview_type(
    ext: &str,
    guessed_mime: Option<&str>,
    magic_mime: Option<&str>,
    likely_text: bool,
) -> PreviewType {
    let ext_type = classify_by_extension(ext);

    if let Some(magic_type) = magic_mime.and_then(preview_type_from_mime)
        && (ext_type == PreviewType::Binary || is_magic_override_candidate(&magic_type))
    {
        return magic_type;
    }

    if ext_type != PreviewType::Binary {
        return ext_type;
    }

    if let Some(guessed_type) = guessed_mime.and_then(preview_type_from_mime) {
        return guessed_type;
    }

    if likely_text {
        return PreviewType::Code;
    }

    PreviewType::Binary
}

fn code_mime_from_extension(ext: &str) -> &'static str {
    match ext {
        "json" => "application/json",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "tsv" => "text/tab-separated-values",
        _ => "text/plain",
    }
}

fn archive_mime_from_extension(ext: &str) -> &'static str {
    match ext {
        "zip" => "application/zip",
        "tar" => "application/x-tar",
        "gz" | "tgz" => "application/gzip",
        _ => "application/octet-stream",
    }
}

fn office_mime_from_extension(ext: &str) -> &'static str {
    match ext {
        "doc" => "application/msword",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls" => "application/vnd.ms-excel",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "ppt" => "application/vnd.ms-powerpoint",
        _ => "application/octet-stream",
    }
}

fn resolve_preview_mime(
    ext: &str,
    preview_type: &PreviewType,
    guessed_mime: Option<&str>,
    magic_mime: Option<&str>,
) -> String {
    match preview_type {
        PreviewType::Markdown => "text/markdown".to_string(),
        PreviewType::Html => "text/html".to_string(),
        PreviewType::Code => code_mime_from_extension(ext).to_string(),
        PreviewType::Pdf => "application/pdf".to_string(),
        PreviewType::Docx => {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document".to_string()
        }
        PreviewType::Archive => {
            if let Some(mime) = magic_mime
                .filter(|mime| preview_type_from_mime(mime).as_ref() == Some(preview_type))
            {
                mime.to_string()
            } else if let Some(mime) = guessed_mime
                .filter(|mime| preview_type_from_mime(mime).as_ref() == Some(preview_type))
            {
                mime.to_string()
            } else {
                archive_mime_from_extension(ext).to_string()
            }
        }
        PreviewType::Office => {
            if let Some(mime) = guessed_mime
                .filter(|mime| preview_type_from_mime(mime).as_ref() == Some(preview_type))
            {
                mime.to_string()
            } else {
                office_mime_from_extension(ext).to_string()
            }
        }
        PreviewType::Image | PreviewType::Video | PreviewType::Audio => {
            if let Some(mime) = magic_mime
                .filter(|mime| preview_type_from_mime(mime).as_ref() == Some(preview_type))
            {
                mime.to_string()
            } else if let Some(mime) = guessed_mime
                .filter(|mime| preview_type_from_mime(mime).as_ref() == Some(preview_type))
            {
                mime.to_string()
            } else {
                "application/octet-stream".to_string()
            }
        }
        PreviewType::Binary => guessed_mime
            .unwrap_or("application/octet-stream")
            .to_string(),
    }
}

pub(crate) fn inspect_path(path: &Path) -> PathInspection {
    let ext = extension_from_path(path);
    let guessed_mime = mime_guess::from_path(path)
        .first_raw()
        .map(|mime| mime.to_string());
    let sniff_bytes = read_sniff_bytes(path).unwrap_or_default();
    let magic_mime = get_magic_mime(&sniff_bytes).map(str::to_string);
    let likely_text = is_likely_text(&sniff_bytes);
    let preview_type = resolve_preview_type(
        &ext,
        guessed_mime.as_deref(),
        magic_mime.as_deref(),
        likely_text,
    );
    let mime = resolve_preview_mime(
        &ext,
        &preview_type,
        guessed_mime.as_deref(),
        magic_mime.as_deref(),
    );

    PathInspection {
        ext,
        preview_type,
        mime,
    }
}

pub fn detect_file_type(path_str: &str) -> crate::error::Result<FileMeta> {
    let path = Path::new(path_str);

    if !path.exists() {
        return Err("File not found".to_string());
    }

    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let size = metadata.len();
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let inspection = inspect_path(path);

    let (supported_modes, default_mode) = match inspection.preview_type {
        PreviewType::Markdown => (
            vec![PreviewMode::Rendered, PreviewMode::Source],
            PreviewMode::Rendered,
        ),
        PreviewType::Html => (
            vec![PreviewMode::Source, PreviewMode::Rendered],
            PreviewMode::Source,
        ),
        PreviewType::Docx => (vec![PreviewMode::Rendered], PreviewMode::Rendered),
        PreviewType::Code if inspection.ext == "json" || inspection.ext == "xml" => (
            vec![PreviewMode::Formatted, PreviewMode::Source],
            PreviewMode::Formatted,
        ),
        PreviewType::Code if inspection.ext == "csv" || inspection.ext == "tsv" => (
            vec![PreviewMode::Table, PreviewMode::Source],
            PreviewMode::Table,
        ),
        _ => (vec![PreviewMode::Default], PreviewMode::Default),
    };

    Ok(FileMeta {
        path: path_str.to_string(),
        name,
        size,
        preview_type: inspection.preview_type,
        supported_modes,
        default_mode,
        mime: inspection.mime,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{PreviewType, inspect_path};

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(prefix: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock before epoch")
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("{prefix}-{}-{unique}", std::process::id()));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }

        fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.path.join(name);
            fs::write(&path, bytes).expect("write temp file");
            path
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn inspect(path: &Path) -> super::PathInspection {
        inspect_path(path)
    }

    #[test]
    fn typescript_sources_stay_code_even_when_extension_mime_is_video() {
        let dir = TempDirGuard::new("ctxrun-hyperview-ts");
        let path = dir.write("main.ts", b"const answer: number = 42;\n");

        let inspection = inspect(&path);

        assert_eq!(inspection.preview_type, PreviewType::Code);
        assert_eq!(inspection.mime, "text/plain");
    }

    #[test]
    fn real_media_can_override_a_code_extension_via_magic_bytes() {
        let dir = TempDirGuard::new("ctxrun-hyperview-fake-ts");
        let png_bytes = [
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
            8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 255,
            255, 63, 0, 5, 254, 2, 254, 167, 53, 129, 132, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96,
            130,
        ];
        let path = dir.write("video.ts", &png_bytes);

        let inspection = inspect(&path);

        assert_eq!(inspection.preview_type, PreviewType::Image);
        assert_eq!(inspection.mime, "image/png");
    }

    #[test]
    fn extensionless_text_files_fall_back_to_code_preview() {
        let dir = TempDirGuard::new("ctxrun-hyperview-text");
        let path = dir.write("envfile", b"PORT=3000\nMODE=dev\n");

        let inspection = inspect(&path);

        assert_eq!(inspection.preview_type, PreviewType::Code);
        assert_eq!(inspection.mime, "text/plain");
    }
}
