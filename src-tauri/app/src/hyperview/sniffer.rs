use serde::Serialize;
use std::path::Path;
use std::fs::File;
use std::io::Read;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PreviewType {
    Image,
    Video,
    Audio,
    Code,      // 源代码/纯文本
    Markdown,
    Pdf,
    Archive,   // Zip, Tar...
    Binary,    // 未知/二进制
    Office,    // Docx, Xlsx...
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub preview_type: PreviewType,
    pub mime: String,
}

/// 读取文件头几个字节来辅助判断
fn get_magic_type(path: &Path) -> Option<infer::Type> {
    // 只读前 8KB 足够判断类型
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return None,
    };
    let mut buffer = [0; 8192];
    let _ = file.read(&mut buffer);
    infer::get(&buffer)
}

pub fn detect_file_type(path_str: &str) -> Result<FileMeta, String> {
    let path = Path::new(path_str);

    if !path.exists() {
        return Err("File not found".to_string());
    }

    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let size = metadata.len();
    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();

    // 1. 优先尝试扩展名 (速度最快)
    let ext = path.extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let mime = mime_guess::from_path(path).first_or_text_plain().to_string();

    // 2. 初始判断逻辑
    let mut p_type = match ext.as_str() {
        "md" | "markdown" => PreviewType::Markdown,
        "txt" | "json" | "rs" | "js" | "ts" | "tsx" | "jsx" | "css" | "html" | "xml" | "yml" | "yaml" | "toml" | "sql" | "py" | "java" | "c" | "cpp" | "h" | "sh" | "bat" | "cmd" | "ps1" | "log" | "ini" | "conf" => PreviewType::Code,
        "pdf" => PreviewType::Pdf,
        "zip" | "rar" | "7z" | "tar" | "gz" => PreviewType::Archive,
        "docx" | "doc" | "xlsx" | "xls" | "pptx" | "ppt" => PreviewType::Office,
        _ => PreviewType::Binary, // 默认为二进制，稍后修正
    };

    // 3. 如果扩展名判断为 Binary，或者属于媒体类型，使用 Magic Bytes 二次确认
    // 这样可以避免把改了后缀的 exe 当成 txt，或者把无后缀的 png 当成 binary
    if p_type == PreviewType::Binary || mime.starts_with("image/") || mime.starts_with("video/") || mime.starts_with("audio/") {
        if let Some(kind) = get_magic_type(path) {
            let mime_type = kind.mime_type();
            if mime_type.starts_with("image/") {
                p_type = PreviewType::Image;
            } else if mime_type.starts_with("video/") {
                p_type = PreviewType::Video;
            } else if mime_type.starts_with("audio/") {
                p_type = PreviewType::Audio;
            } else if mime_type.starts_with("text/") {
                p_type = PreviewType::Code;
            }
        } else {
            // 如果 infer 没识别出来，但 mime_guess 说是文本，那就按文本处理
            if mime.starts_with("text/") {
                p_type = PreviewType::Code;
            }
        }
    }

    Ok(FileMeta {
        path: path_str.to_string(),
        name,
        size,
        preview_type: p_type,
        mime,
    })
}
