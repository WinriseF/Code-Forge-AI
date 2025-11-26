#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::fs;
use tauri::{GlobalShortcutManager, Manager};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// 获取文件大小的命令
#[tauri::command]
fn get_file_size(path: String) -> u64 {
    match fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(_) => 0, // 如果读取失败（如权限问题），返回 0
    }
}

fn main() {
    tauri::Builder::default()
        // 注册 get_file_size
        .invoke_handler(tauri::generate_handler![greet, get_file_size])
        
        // 在 setup 钩子中注册快捷键
        .setup(|app| {
            let app_handle = app.handle();
            
            // 注册 Alt+Space (macOS 上通常是 Option+Space，Windows 是 Alt+Space)
            let mut shortcut = app.global_shortcut_manager();
            
            // 尝试注册快捷键
            let _ = shortcut.register("Alt+S", move || {
                let window = app_handle.get_window("spotlight").unwrap();
                
                if window.is_visible().unwrap() {
                    window.hide().unwrap();
                } else {
                    // 显示并强制聚焦，确保用户可以直接输入
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}