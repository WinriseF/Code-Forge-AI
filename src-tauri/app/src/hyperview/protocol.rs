use tauri::http::{Request, Response, StatusCode, header};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use percent_encoding::percent_decode_str;

pub fn preview_protocol_handler<R: tauri::Runtime>(
    _ctx: tauri::UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    // 1. 解析路径
    // 这里的 uri 类似于 "preview://localhost/C%3A%2Fpath%2Fto%2Ffile.png" (Windows)
    // 或者 "preview://localhost/Users/name/file.png" (Unix)
    let uri = request.uri();
    let uri_str = uri.to_string();

    // 移除协议头 "preview://"
    // 注意：Tauri v2 的 request.uri() 返回的是完整 URL
    let path_str = uri_str.replace("preview://localhost", "").replace("preview://", "");

    // URL 解码 (处理空格、特殊字符)
    let decoded_path = percent_decode_str(&path_str).decode_utf8_lossy().to_string();

    // 处理 Windows 路径问题 (移除开头的 /，如果是 /C:/...)
    #[cfg(target_os = "windows")]
    let final_path_str = if decoded_path.starts_with('/') && decoded_path.chars().nth(2) == Some(':') {
        &decoded_path[1..]
    } else {
        &decoded_path
    };

    #[cfg(not(target_os = "windows"))]
    let final_path_str = &decoded_path;

    let path = Path::new(final_path_str);

    // 2. 安全检查：虽然是本地工具，但最好还是做个 basic check
    if !path.exists() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap_or_default();
    }

    // 3. 读取文件 (流式读取优化)
    // 注意：对于超大文件，Tauri 的 protocol 目前可能需要一次性读取 buffer
    // 真正的流式需要 Response::new(Body::from_stream(...))，这里先用简单读取，对图片足够快
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Vec::new())
                .unwrap_or_default();
        }
    };

    let mut buffer = Vec::new();
    if file.read_to_end(&mut buffer).is_err() {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Vec::new())
            .unwrap_or_default();
    }

    // 4. 猜测 MIME
    let mime_type = mime_guess::from_path(path).first_or_octet_stream();

    // 5. 返回响应
    Response::builder()
        .header(header::CONTENT_TYPE, mime_type.as_ref())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(buffer)
        .unwrap_or_default()
}
