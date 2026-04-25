use percent_encoding::percent_decode_str;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use tauri::http::{Request, Response, StatusCode, header};

pub fn preview_protocol_handler<R: tauri::Runtime>(
    _ctx: tauri::UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let uri = request.uri();
    let path_str = uri.path().trim_start_matches('/').to_string();
    let path_str = if path_str.is_empty() {
        uri.host().unwrap_or_default().to_string()
    } else {
        path_str
    };

    let decoded_path = percent_decode_str(&path_str)
        .decode_utf8_lossy()
        .to_string();

    #[cfg(target_os = "windows")]
    let final_path_str =
        if decoded_path.starts_with('/') && decoded_path.chars().nth(2) == Some(':') {
            &decoded_path[1..]
        } else {
            &decoded_path
        };

    #[cfg(not(target_os = "windows"))]
    let final_path_str = &decoded_path;

    let path = Path::new(final_path_str);

    if !path.exists() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap_or_default();
    }

    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Vec::new())
                .unwrap_or_default();
        }
    };
    let file_size = metadata.len();

    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Vec::new())
                .unwrap_or_default();
        }
    };

    let inspection = crate::sniffer::inspect_path(path);
    let mime_type = inspection.mime;

    let range_header = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());

    if let Some(range_header) = range_header {
        match parse_single_range(range_header, file_size) {
            Some((start, end)) => {
                let content_length = end - start + 1;
                let mut buffer = Vec::with_capacity(content_length as usize);

                if file.seek(SeekFrom::Start(start)).is_err()
                    || file.take(content_length).read_to_end(&mut buffer).is_err()
                {
                    return Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .body(Vec::new())
                        .unwrap_or_default();
                }

                return Response::builder()
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(header::CONTENT_TYPE, mime_type.as_str())
                    .header(header::CONTENT_LENGTH, content_length.to_string())
                    .header(
                        header::CONTENT_RANGE,
                        format!("bytes {start}-{end}/{file_size}"),
                    )
                    .header(header::ACCEPT_RANGES, "bytes")
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(buffer)
                    .unwrap_or_default();
            }
            None => {
                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{file_size}"))
                    .header(header::ACCEPT_RANGES, "bytes")
                    .body(Vec::new())
                    .unwrap_or_default();
            }
        }
    }

    let mut buffer = Vec::with_capacity(file_size as usize);
    if file.read_to_end(&mut buffer).is_err() {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Vec::new())
            .unwrap_or_default();
    }

    Response::builder()
        .header(header::CONTENT_TYPE, mime_type.as_str())
        .header(header::CONTENT_LENGTH, file_size.to_string())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(buffer)
        .unwrap_or_default()
}

fn parse_single_range(range_header: &str, file_size: u64) -> Option<(u64, u64)> {
    if file_size == 0 {
        return None;
    }

    let range = range_header
        .strip_prefix("bytes=")?
        .split(',')
        .next()?
        .trim();
    let (start, end) = range.split_once('-')?;

    if start.is_empty() {
        let suffix_len = end.parse::<u64>().ok()?;
        if suffix_len == 0 {
            return None;
        }

        let length = suffix_len.min(file_size);
        return Some((file_size - length, file_size - 1));
    }

    let start = start.parse::<u64>().ok()?;
    if start >= file_size {
        return None;
    }

    let end = if end.is_empty() {
        file_size - 1
    } else {
        end.parse::<u64>().ok()?.min(file_size - 1)
    };

    if start > end {
        return None;
    }

    Some((start, end))
}
