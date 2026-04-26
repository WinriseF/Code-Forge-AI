use serde::Serialize;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

const ZIP_MIME: &str = "application/zip";
const PDF_MIME: &str = "application/pdf";
const DOCX_MIME: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX_MIME: &str = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContainerKind {
    Zip,
    OoxmlWord,
    OoxmlSheet,
    OoxmlSlides,
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

fn has_zip_signature(bytes: &[u8]) -> bool {
    bytes.len() > 3
        && bytes[0] == 0x50
        && bytes[1] == 0x4B
        && matches!(
            (bytes[2], bytes[3]),
            (0x03, 0x04) | (0x05, 0x06) | (0x07, 0x08)
        )
}

fn is_zip_like_mime(mime: &str) -> bool {
    matches!(mime, ZIP_MIME | DOCX_MIME | XLSX_MIME | PPTX_MIME)
}

fn should_probe_zip_container(
    ext: &str,
    guessed_mime: Option<&str>,
    magic_mime: Option<&str>,
    bytes: &[u8],
) -> bool {
    matches!(ext, "zip" | "docx" | "xlsx" | "pptx")
        || guessed_mime.is_some_and(is_zip_like_mime)
        || magic_mime.is_some_and(is_zip_like_mime)
        || has_zip_signature(bytes)
}

fn probe_zip_container(path: &Path) -> Option<ContainerKind> {
    let file = File::open(path).ok()?;
    let mut archive = ZipArchive::new(file).ok()?;
    let entry_count = archive.len();

    if entry_count == 0 {
        return Some(ContainerKind::Zip);
    }

    let mut has_content_types = false;
    let mut has_word_document = false;
    let mut has_workbook = false;
    let mut has_presentation = false;

    for index in 0..entry_count {
        let file = match archive.by_index(index) {
            Ok(file) => file,
            Err(_) => return Some(ContainerKind::Zip),
        };
        let name = file.name().replace('\\', "/");

        if name.eq_ignore_ascii_case("[Content_Types].xml") {
            has_content_types = true;
        } else if name.eq_ignore_ascii_case("word/document.xml") {
            has_word_document = true;
        } else if name.eq_ignore_ascii_case("xl/workbook.xml") {
            has_workbook = true;
        } else if name.eq_ignore_ascii_case("ppt/presentation.xml") {
            has_presentation = true;
        }

        if has_content_types && has_word_document {
            return Some(ContainerKind::OoxmlWord);
        }
        if has_content_types && has_workbook {
            return Some(ContainerKind::OoxmlSheet);
        }
        if has_content_types && has_presentation {
            return Some(ContainerKind::OoxmlSlides);
        }
    }

    Some(ContainerKind::Zip)
}

fn probe_container(
    path: &Path,
    ext: &str,
    guessed_mime: Option<&str>,
    magic_mime: Option<&str>,
    bytes: &[u8],
) -> Option<ContainerKind> {
    if !should_probe_zip_container(ext, guessed_mime, magic_mime, bytes) {
        return None;
    }

    probe_zip_container(path)
}

fn classify_by_extension(ext: &str) -> PreviewType {
    if ext == "md" || ext == "markdown" {
        PreviewType::Markdown
    } else if ext == "htm" || ext == "html" {
        PreviewType::Html
    } else if ext == "svg"
        || ext == "png"
        || ext == "jpg"
        || ext == "jpeg"
        || ext == "gif"
        || ext == "webp"
        || ext == "bmp"
        || ext == "ico"
        || ext == "avif"
    {
        PreviewType::Image
    } else if ext == "mp4"
        || ext == "webm"
        || ext == "mov"
        || ext == "avi"
        || ext == "mkv"
        || ext == "m4v"
    {
        PreviewType::Video
    } else if ext == "mp3"
        || ext == "wav"
        || ext == "ogg"
        || ext == "m4a"
        || ext == "flac"
        || ext == "aac"
    {
        PreviewType::Audio
    } else if ext == "txt"
        || ext == "json"
        || ext == "rs"
        || ext == "js"
        || ext == "mjs"
        || ext == "cjs"
        || ext == "ts"
        || ext == "tsx"
        || ext == "mts"
        || ext == "cts"
        || ext == "jsx"
        || ext == "css"
        || ext == "xml"
        || ext == "yml"
        || ext == "yaml"
        || ext == "toml"
        || ext == "sql"
        || ext == "py"
        || ext == "java"
        || ext == "c"
        || ext == "cpp"
        || ext == "h"
        || ext == "sh"
        || ext == "bat"
        || ext == "cmd"
        || ext == "ps1"
        || ext == "log"
        || ext == "ini"
        || ext == "conf"
        || ext == "csv"
        || ext == "tsv"
    {
        PreviewType::Code
    } else if ext == "pdf" {
        PreviewType::Pdf
    } else if ext == "docx" {
        PreviewType::Docx
    } else if ext == "zip" || ext == "tar" || ext == "gz" || ext == "tgz" {
        PreviewType::Archive
    } else if ext == "doc" || ext == "xlsx" || ext == "xls" || ext == "pptx" || ext == "ppt" {
        PreviewType::Office
    } else {
        PreviewType::Binary
    }
}

fn preview_type_from_mime(mime: &str) -> Option<PreviewType> {
    if mime == "image/svg+xml" {
        Some(PreviewType::Image)
    } else if mime == "text/markdown" {
        Some(PreviewType::Markdown)
    } else if mime == "text/html" || mime == "application/xhtml+xml" {
        Some(PreviewType::Html)
    } else if mime == PDF_MIME {
        Some(PreviewType::Pdf)
    } else if mime == DOCX_MIME {
        Some(PreviewType::Docx)
    } else if mime == ZIP_MIME || mime == "application/x-tar" || mime == "application/gzip" || mime == "application/x-gzip" {
        Some(PreviewType::Archive)
    } else if mime == "application/msword"
        || mime == XLSX_MIME
        || mime == "application/vnd.ms-excel"
        || mime == PPTX_MIME
        || mime == "application/vnd.ms-powerpoint"
    {
        Some(PreviewType::Office)
    } else if mime == "application/json" || mime == "application/javascript" {
        Some(PreviewType::Code)
    } else if mime.starts_with("image/") {
        Some(PreviewType::Image)
    } else if mime.starts_with("video/") {
        Some(PreviewType::Video)
    } else if mime.starts_with("audio/") {
        Some(PreviewType::Audio)
    } else if mime.starts_with("text/") {
        Some(PreviewType::Code)
    } else if mime.ends_with("+json") || mime == "application/xml" || mime.ends_with("+xml") {
        Some(PreviewType::Code)
    } else {
        None
    }
}

fn code_mime_from_extension(ext: &str) -> &'static str {
    if ext == "json" {
        "application/json"
    } else if ext == "xml" {
        "application/xml"
    } else if ext == "csv" {
        "text/csv"
    } else if ext == "tsv" {
        "text/tab-separated-values"
    } else {
        "text/plain"
    }
}

fn archive_mime_from_extension(ext: &str) -> &'static str {
    if ext == "zip" {
        "application/zip"
    } else if ext == "tar" {
        "application/x-tar"
    } else if ext == "gz" || ext == "tgz" {
        "application/gzip"
    } else {
        "application/octet-stream"
    }
}

fn office_mime_from_extension(ext: &str) -> &'static str {
    if ext == "doc" {
        "application/msword"
    } else if ext == "xlsx" {
        XLSX_MIME
    } else if ext == "xls" {
        "application/vnd.ms-excel"
    } else if ext == "pptx" {
        PPTX_MIME
    } else if ext == "ppt" {
        "application/vnd.ms-powerpoint"
    } else {
        "application/octet-stream"
    }
}

fn is_textual_preview_type(preview_type: &PreviewType) -> bool {
    *preview_type == PreviewType::Code
        || *preview_type == PreviewType::Markdown
        || *preview_type == PreviewType::Html
}

fn should_magic_override(ext_type: &PreviewType, magic_type: &PreviewType) -> bool {
    if *ext_type == PreviewType::Binary {
        return true;
    }

    *magic_type == PreviewType::Image
        || *magic_type == PreviewType::Video
        || *magic_type == PreviewType::Audio
        || *magic_type == PreviewType::Pdf
        || *magic_type == PreviewType::Archive
}

fn canonical_mime_for_preview_type(ext: &str, preview_type: &PreviewType) -> &'static str {
    if *preview_type == PreviewType::Markdown {
        "text/markdown"
    } else if *preview_type == PreviewType::Html {
        "text/html"
    } else if *preview_type == PreviewType::Code {
        code_mime_from_extension(ext)
    } else if *preview_type == PreviewType::Pdf {
        PDF_MIME
    } else if *preview_type == PreviewType::Docx {
        DOCX_MIME
    } else if *preview_type == PreviewType::Archive {
        archive_mime_from_extension(ext)
    } else if *preview_type == PreviewType::Office {
        office_mime_from_extension(ext)
    } else {
        "application/octet-stream"
    }
}

fn mime_matches_preview_type(mime: &str, preview_type: &PreviewType) -> bool {
    preview_type_from_mime(mime).as_ref() == Some(preview_type)
}

fn resolve_mime(
    ext: &str,
    preview_type: &PreviewType,
    guessed_mime: Option<&str>,
    magic_mime: Option<&str>,
) -> String {
    if let Some(magic_mime) = magic_mime
        .filter(|mime| mime_matches_preview_type(mime, preview_type))
    {
        return magic_mime.to_string();
    }

    if let Some(guessed_mime) = guessed_mime
        .filter(|mime| mime_matches_preview_type(mime, preview_type))
    {
        return guessed_mime.to_string();
    }

    canonical_mime_for_preview_type(ext, preview_type).to_string()
}

fn resolve_text_preview_type(
    guessed_mime: Option<&str>,
    magic_mime: Option<&str>,
) -> PreviewType {
    if let Some(preview_type) = magic_mime
        .and_then(preview_type_from_mime)
        .filter(is_textual_preview_type)
    {
        preview_type
    } else if let Some(preview_type) = guessed_mime
        .and_then(preview_type_from_mime)
        .filter(is_textual_preview_type)
    {
        preview_type
    } else {
        PreviewType::Code
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
    let ext_type = classify_by_extension(&ext);

    if let Some(container_kind) = probe_container(
        path,
        &ext,
        guessed_mime.as_deref(),
        magic_mime.as_deref(),
        &sniff_bytes,
    ) {
        if container_kind == ContainerKind::OoxmlWord {
            return PathInspection {
                ext,
                preview_type: PreviewType::Docx,
                mime: DOCX_MIME.to_string(),
            };
        }

        if container_kind == ContainerKind::OoxmlSheet {
            return PathInspection {
                ext,
                preview_type: PreviewType::Office,
                mime: XLSX_MIME.to_string(),
            };
        }

        if container_kind == ContainerKind::OoxmlSlides {
            return PathInspection {
                ext,
                preview_type: PreviewType::Office,
                mime: PPTX_MIME.to_string(),
            };
        }

        return PathInspection {
            ext,
            preview_type: PreviewType::Archive,
            mime: ZIP_MIME.to_string(),
        };
    }

    if let Some(magic_mime) = magic_mime.as_deref()
        && let Some(magic_type) = preview_type_from_mime(magic_mime)
        && should_magic_override(&ext_type, &magic_type)
    {
        let mime = resolve_mime(&ext, &magic_type, guessed_mime.as_deref(), Some(magic_mime));
        return PathInspection {
            ext,
            mime,
            preview_type: magic_type,
        };
    }

    if ext_type != PreviewType::Binary {
        let mime = resolve_mime(&ext, &ext_type, guessed_mime.as_deref(), magic_mime.as_deref());
        return PathInspection {
            ext,
            mime,
            preview_type: ext_type,
        };
    }

    if likely_text {
        let preview_type = resolve_text_preview_type(guessed_mime.as_deref(), magic_mime.as_deref());
        let mime = resolve_mime(&ext, &preview_type, guessed_mime.as_deref(), magic_mime.as_deref());
        return PathInspection {
            ext,
            mime,
            preview_type,
        };
    }

    if let Some(guessed_mime) = guessed_mime.as_deref()
        && let Some(preview_type) = preview_type_from_mime(guessed_mime)
    {
        let mime = resolve_mime(&ext, &preview_type, Some(guessed_mime), magic_mime.as_deref());
        return PathInspection {
            ext,
            mime,
            preview_type,
        };
    }

    PathInspection {
        ext,
        preview_type: PreviewType::Binary,
        mime: guessed_mime.unwrap_or_else(|| "application/octet-stream".to_string()),
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

    let (supported_modes, default_mode) = if inspection.preview_type == PreviewType::Markdown {
        (
            vec![PreviewMode::Rendered, PreviewMode::Source],
            PreviewMode::Rendered,
        )
    } else if inspection.preview_type == PreviewType::Html {
        (
            vec![PreviewMode::Source, PreviewMode::Rendered],
            PreviewMode::Source,
        )
    } else if inspection.preview_type == PreviewType::Docx {
        (vec![PreviewMode::Rendered], PreviewMode::Rendered)
    } else if inspection.preview_type == PreviewType::Code
        && (inspection.ext == "json" || inspection.ext == "xml")
    {
        (
            vec![PreviewMode::Formatted, PreviewMode::Source],
            PreviewMode::Formatted,
        )
    } else if inspection.preview_type == PreviewType::Code
        && (inspection.ext == "csv" || inspection.ext == "tsv")
    {
        (vec![PreviewMode::Table, PreviewMode::Source], PreviewMode::Table)
    } else {
        (vec![PreviewMode::Default], PreviewMode::Default)
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
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{PreviewType, inspect_path};
    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

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

        fn write_zip(&self, name: &str, entries: &[(&str, &[u8])]) -> PathBuf {
            let path = self.path.join(name);
            let file = File::create(&path).expect("create zip file");
            let mut writer = ZipWriter::new(file);

            for (entry_name, bytes) in entries {
                let options =
                    SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
                writer
                    .start_file(*entry_name, options)
                    .expect("start zip entry");
                writer.write_all(bytes).expect("write zip entry");
            }

            writer.finish().expect("finish zip file");
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

    #[test]
    fn svg_files_keep_svg_image_mime() {
        let dir = TempDirGuard::new("ctxrun-hyperview-svg");
        let path = dir.write(
            "icon.svg",
            br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>"#,
        );

        let inspection = inspect(&path);

        assert_eq!(inspection.preview_type, PreviewType::Image);
        assert_eq!(inspection.mime, "image/svg+xml");
    }

    #[test]
    fn ooxml_word_container_without_extension_is_detected_as_docx() {
        let dir = TempDirGuard::new("ctxrun-hyperview-ooxml-word");
        let path = dir.write_zip(
            "report",
            &[
                ("custom/data.bin", b"not-docx-magic-order"),
                ("[Content_Types].xml", b"<Types/>"),
                ("word/document.xml", b"<w:document/>"),
            ],
        );

        let inspection = inspect(&path);

        assert_eq!(inspection.preview_type, PreviewType::Docx);
        assert_eq!(inspection.mime, super::DOCX_MIME);
    }

    #[test]
    fn ooxml_sheet_container_without_extension_is_detected_as_office() {
        let dir = TempDirGuard::new("ctxrun-hyperview-ooxml-sheet");
        let path = dir.write_zip(
            "sheet",
            &[
                ("random.bin", b"not-sheet-magic-order"),
                ("[Content_Types].xml", b"<Types/>"),
                ("xl/workbook.xml", b"<workbook/>"),
            ],
        );

        let inspection = inspect(&path);

        assert_eq!(inspection.preview_type, PreviewType::Office);
        assert_eq!(inspection.mime, super::XLSX_MIME);
    }

    #[test]
    fn ooxml_slides_container_without_extension_is_detected_as_office() {
        let dir = TempDirGuard::new("ctxrun-hyperview-ooxml-slides");
        let path = dir.write_zip(
            "slides",
            &[
                ("random.bin", b"not-slides-magic-order"),
                ("[Content_Types].xml", b"<Types/>"),
                ("ppt/presentation.xml", b"<presentation/>"),
            ],
        );

        let inspection = inspect(&path);

        assert_eq!(inspection.preview_type, PreviewType::Office);
        assert_eq!(inspection.mime, super::PPTX_MIME);
    }

    #[test]
    fn generic_zip_named_docx_stays_archive() {
        let dir = TempDirGuard::new("ctxrun-hyperview-generic-zip-docx");
        let path = dir.write_zip(
            "fake.docx",
            &[
                ("notes/readme.txt", b"hello"),
                ("assets/icon.png", b"not-a-real-png"),
            ],
        );

        let inspection = inspect(&path);

        assert_eq!(inspection.preview_type, PreviewType::Archive);
        assert_eq!(inspection.mime, super::ZIP_MIME);
    }
}
