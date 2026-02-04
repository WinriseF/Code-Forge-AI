use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::any::Any;
use super::ToolInfo;

const MAX_READ_SIZE: u64 = 50 * 1024;

pub trait ProjectScanner: Send + Sync + Any {
    fn match_identity(&self, root: &str) -> bool;
    fn detect_toolchain(&self) -> Option<ToolInfo>;
    fn parse_dependencies(&self, root: &str) -> HashMap<String, String>;
}

pub fn read_file_head(path: &Path) -> Option<String> {
    if !path.exists() {
        return None;
    }

    if let Ok(mut file) = File::open(path) {
        let len = file.metadata().map(|m| m.len()).unwrap_or(0);
        let read_len = std::cmp::min(len, MAX_READ_SIZE) as usize;
        let mut buffer = vec![0u8; read_len];
        if file.read_exact(&mut buffer).is_ok() {
            return Some(String::from_utf8_lossy(&buffer).to_string());
        }
        let _ = file.seek(SeekFrom::Start(0));
        let mut fallback_buffer = Vec::new();
        if file.take(MAX_READ_SIZE).read_to_end(&mut fallback_buffer).is_ok() {
             return Some(String::from_utf8_lossy(&fallback_buffer).to_string());
        }
    }
    None
}