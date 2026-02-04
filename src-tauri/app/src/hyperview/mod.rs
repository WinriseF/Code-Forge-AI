pub mod sniffer;
pub mod protocol;

use self::sniffer::FileMeta;

#[tauri::command]
pub async fn get_file_meta(path: String) -> Result<FileMeta, String> {
    // 这是一个 CPU 密集型任务（涉及 IO 和 计算），放入 blocking thread
    tauri::async_runtime::spawn_blocking(move || {
        sniffer::detect_file_type(&path)
    }).await.map_err(|e| e.to_string())?
}
