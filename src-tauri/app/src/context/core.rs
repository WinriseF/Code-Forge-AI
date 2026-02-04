use std::fs;
use std::path::Path;
use rayon::prelude::*;
use serde::Serialize;
use super::{tokenizer, processing};

#[derive(Debug, Serialize)]
pub struct ContextStats {
    pub file_count: usize,
    pub total_size: usize,
    pub total_tokens: usize,
}

const MAX_FILE_SIZE: u64 = 1024 * 1024;
const BINARY_CHECK_BYTES: usize = 8000;

fn read_and_process_file(path: &str, remove_comments: bool) -> String {
    let p = Path::new(path);

    if let Ok(meta) = fs::metadata(p) {
        if meta.len() > MAX_FILE_SIZE {
            return format!("<file path=\"{}\">\n[File too large: {} bytes]\n</file>", path, meta.len());
        }
    } else {
        return format!("<file path=\"{}\">\n[Error: File not found]\n</file>", path);
    }

    match fs::read(p) {
        Ok(bytes) => {
            if bytes.iter().take(BINARY_CHECK_BYTES).any(|&b| b == 0) {
                return format!("<file path=\"{}\">\n[Binary file omitted]\n</file>", path);
            }

            let content = String::from_utf8_lossy(&bytes);

            let final_content = if remove_comments {
                let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                processing::strip_comments(&content, &ext)
            } else {
                content.to_string()
            };

            format!("<file path=\"{}\">\n{}\n</file>", path, final_content)
        },
        Err(e) => format!("<file path=\"{}\">\n[Error reading file: {}]\n</file>", path, e)
    }
}

pub fn calculate_stats_parallel(paths: Vec<String>, remove_comments: bool) -> ContextStats {
    let (total_size, total_tokens) = paths.par_iter()
        .map(|path| {
            let xml_block = read_and_process_file(path, remove_comments);
            let size = xml_block.len();
            let tokens = tokenizer::count_tokens(&xml_block);
            (size, tokens)
        })
        .reduce(|| (0, 0), |a, b| (a.0 + b.0, a.1 + b.1));

    ContextStats {
        file_count: paths.len(),
        total_size,
        total_tokens,
    }
}

pub fn assemble_context_parallel(paths: Vec<String>, header: String, remove_comments: bool) -> String {
    let file_blocks: Vec<String> = paths.par_iter()
        .map(|path| read_and_process_file(path, remove_comments))
        .collect();

    let mut full_text = String::with_capacity(header.len() + file_blocks.iter().map(|s| s.len()).sum::<usize>() + 100);

    full_text.push_str(&header);
    full_text.push_str("\n<source_files>\n");
    for block in file_blocks {
        full_text.push_str(&block);
        full_text.push('\n');
    }
    full_text.push_str("</source_files>\n</project_context>");

    full_text
}
