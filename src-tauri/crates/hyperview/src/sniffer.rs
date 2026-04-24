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

fn get_magic_type(path: &Path) -> Option<infer::Type> {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return None,
    };
    let mut buffer = [0; 8192];
    let _ = file.read(&mut buffer);
    infer::get(&buffer)
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

    let ext = path
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let mime = mime_guess::from_path(path)
        .first_or_text_plain()
        .to_string();

    let mut p_type = match ext.as_str() {
        "md" | "markdown" => PreviewType::Markdown,
        "htm" | "html" => PreviewType::Html,
        "txt" | "json" | "rs" | "js" | "ts" | "tsx" | "jsx" | "css" | "xml" | "yml" | "yaml"
        | "toml" | "sql" | "py" | "java" | "c" | "cpp" | "h" | "sh" | "bat" | "cmd" | "ps1"
        | "log" | "ini" | "conf" | "csv" | "tsv" => PreviewType::Code,
        "pdf" => PreviewType::Pdf,
        "docx" => PreviewType::Docx,
        "zip" | "rar" | "7z" | "tar" | "gz" | "tgz" => PreviewType::Archive,
        "doc" | "xlsx" | "xls" | "pptx" | "ppt" => PreviewType::Office,
        _ => PreviewType::Binary,
    };

    if p_type == PreviewType::Binary
        || mime.starts_with("image/")
        || mime.starts_with("video/")
        || mime.starts_with("audio/")
    {
        if let Some(kind) = get_magic_type(path) {
            let mime_type = kind.mime_type();
            if mime.starts_with("image/") {
                p_type = PreviewType::Image;
            } else if mime.starts_with("video/") {
                p_type = PreviewType::Video;
            } else if mime.starts_with("audio/") {
                p_type = PreviewType::Audio;
            } else if mime_type.starts_with("image/") {
                p_type = PreviewType::Image;
            } else if mime_type.starts_with("video/") {
                p_type = PreviewType::Video;
            } else if mime_type.starts_with("audio/") {
                p_type = PreviewType::Audio;
            } else if mime_type == "text/html" {
                p_type = PreviewType::Html;
            } else if mime_type.starts_with("text/") {
                p_type = PreviewType::Code;
            }
        } else if mime.starts_with("image/") {
            p_type = PreviewType::Image;
        } else if mime.starts_with("video/") {
            p_type = PreviewType::Video;
        } else if mime.starts_with("audio/") {
            p_type = PreviewType::Audio;
        } else if mime == "text/html" {
            p_type = PreviewType::Html;
        } else if mime.starts_with("text/") {
            p_type = PreviewType::Code;
        }
    }

    let (supported_modes, default_mode) = match p_type {
        PreviewType::Markdown => (
            vec![PreviewMode::Rendered, PreviewMode::Source],
            PreviewMode::Rendered,
        ),
        PreviewType::Html => (
            vec![PreviewMode::Source, PreviewMode::Rendered],
            PreviewMode::Source,
        ),
        PreviewType::Docx => (vec![PreviewMode::Rendered], PreviewMode::Rendered),
        PreviewType::Code if ext == "json" || ext == "xml" => (
            vec![PreviewMode::Formatted, PreviewMode::Source],
            PreviewMode::Formatted,
        ),
        PreviewType::Code if ext == "csv" || ext == "tsv" => (
            vec![PreviewMode::Table, PreviewMode::Source],
            PreviewMode::Table,
        ),
        _ => (vec![PreviewMode::Default], PreviewMode::Default),
    };

    Ok(FileMeta {
        path: path_str.to_string(),
        name,
        size,
        preview_type: p_type,
        supported_modes,
        default_mode,
        mime,
    })
}
