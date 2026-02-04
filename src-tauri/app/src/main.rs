#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::fs;
use std::process::Command;
use std::sync::{Arc, Mutex};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::time::Duration;

use sysinfo::{System, RefreshKind, CpuRefreshKind, MemoryRefreshKind};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::CREATE_NO_WINDOW;
use tauri::{
    AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    RunEvent, WindowEvent,
};
use tokio::time::sleep;

mod git;
mod export;
mod gitleaks;
mod db;
mod monitor;
mod env_probe;
mod apps;
mod context;
mod hyperview;
mod scheduler;
mod refinery;

const MAIN_WINDOW_LABEL: &str = "main";

fn ensure_main_window(app: &AppHandle) {
    match app.get_webview_window(MAIN_WINDOW_LABEL) { Some(window) => {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    } _ => {
        let window_builder = WebviewWindowBuilder::new(
            app,
            MAIN_WINDOW_LABEL,
            WebviewUrl::App("index.html".into())
        )
        .title("CtxRun")
        .inner_size(800.0, 600.0)
        .center()
        .decorations(false)
        .resizable(true)
        .visible(true);

        match window_builder.build() {
            Ok(w) => {
                let _ = w.set_focus();
            }
            Err(e) => eprintln!("Failed to recreate main window: {}", e),
        }
    }}
}

#[tauri::command]
async fn hide_main_window(app: AppHandle, window: WebviewWindow, delay_secs: u64) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())?;

    // 如果延迟为 0，表示不自动销毁窗口
    if delay_secs == 0 {
        return Ok(());
    }

    let app_handle = app.clone();
    let window_label = window.label().to_string();

    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_secs(delay_secs)).await;

        if let Some(w) = app_handle.get_webview_window(&window_label) {
            let is_visible = w.is_visible().unwrap_or(true);

            if !is_visible {
                let _ = w.close();
            }
        }
    });

    Ok(())
}

#[derive(serde::Serialize)]
struct SystemInfo {
    cpu_usage: f64,
    memory_usage: u64,
    memory_total: u64,
    memory_available: u64,
    uptime: u64,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_file_size(path: String) -> u64 {
    match fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(_) => 0,
    }
}

#[tauri::command]
fn get_system_info(
    system: State<'_, Arc<Mutex<System>>>,
) -> SystemInfo {
    let mut sys = system.lock().unwrap();
    
    sys.refresh_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::nothing().with_cpu_usage())
            .with_memory(MemoryRefreshKind::nothing())
    );
    
    let cpu_usage = sys.global_cpu_usage() as f64;
    
    let memory_total = sys.total_memory();
    let memory_used = sys.used_memory();
    let memory_available = sys.available_memory();
    let uptime = System::uptime();
    
    SystemInfo {
        cpu_usage,
        memory_usage: memory_used,
        memory_total,
        memory_available,
        uptime,
    }
}

#[tauri::command]
async fn check_python_env() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        let bin = "python";
        #[cfg(not(target_os = "windows"))]
        let bin = "python3";

        let mut cmd = Command::new(bin);
        cmd.arg("--version");
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW.0);
        let output = cmd.output().map_err(|_| "Not Found".to_string())?;

        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if version.is_empty() {
                Ok(String::from_utf8_lossy(&output.stderr).trim().to_string())
            } else {
                Ok(version)
            }
        } else {
            Err("Not Installed".to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scan_for_secrets(
    state: State<'_, db::DbState>,
    content: String
) -> Result<Vec<gitleaks::SecretMatch>, String> {
    // 1. 先从数据库获取白名单 (在主线程/异步线程做，避免阻塞 rayon 线程池)
    let ignored_set = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        db::secrets::get_all_ignored_values_internal(&conn).map_err(|e| e.to_string())?
    };

    // 2. 执行扫描 (CPU 密集型，放入 blocking 线程)
    let matches = tauri::async_runtime::spawn_blocking(move || {
        let raw_matches = gitleaks::scan_text(&content);

        // 3. 内存过滤：移除在白名单中的项
        if ignored_set.is_empty() {
            raw_matches
        } else {
            raw_matches.into_iter()
                .filter(|m| !ignored_set.contains(&m.value))
                .collect()
        }
    }).await.map_err(|e| e.to_string())?;

    Ok(matches)
}

#[tauri::command]
async fn export_git_diff(
    project_path: String,
    old_hash: String,
    new_hash: String,
    format: export::ExportFormat,
    layout: export::ExportLayout,
    save_path: String,
    selected_paths: Vec<String>,
) -> Result<(), String> {
    
    let all_files = git::get_git_diff(project_path, old_hash, new_hash)?;
    
    let filtered_files: Vec<git::GitDiffFile> = all_files
        .into_iter()
        .filter(|f| selected_paths.contains(&f.path))
        .collect();

    if filtered_files.is_empty() {
        return Err("No files selected for export.".to_string());
    }

    let content = export::generate_export_content(filtered_files, format, layout);

    fs::write(&save_path, content).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            ensure_main_window(app);
        }))
        .register_uri_scheme_protocol("preview", hyperview::protocol::preview_protocol_handler)
        .invoke_handler(tauri::generate_handler![
            hide_main_window,
            greet,
            get_file_size,
            get_system_info,
            check_python_env,
            git::get_git_commits,
            git::get_git_diff,
            git::get_git_diff_text,
            export_git_diff,
            scan_for_secrets,
            db::prompts::get_prompts,
            db::prompts::search_prompts,
            db::prompts::import_prompt_pack,
            db::prompts::batch_import_local_prompts,
            db::prompts::get_prompt_groups,
            db::prompts::save_prompt,
            db::prompts::delete_prompt,
            db::prompts::toggle_prompt_favorite,
            db::prompts::get_prompt_counts,
            db::prompts::export_prompts_to_csv,
            db::prompts::import_prompts_from_csv,
            db::prompts::get_chat_templates,
            db::url_history::record_url_visit,
            db::url_history::search_url_history,
            db::project_config::get_project_config,
            db::project_config::save_project_config,
            db::project_config::export_project_configs,
            db::project_config::import_project_configs,
            db::secrets::add_ignored_secrets,
            db::secrets::get_ignored_secrets,
            db::secrets::delete_ignored_secret,
            db::apps::search_apps_in_db,
            apps::refresh_apps,
            apps::open_app,
            db::shell_history::record_shell_command,
            db::shell_history::get_recent_shell_history,
            db::shell_history::search_shell_history,
            monitor::get_system_metrics,
            monitor::get_top_processes,
            monitor::get_active_ports,
            monitor::kill_process,
            monitor::check_file_locks,
            monitor::get_env_info,
            monitor::diagnose_network,
            monitor::get_ai_context,
            context::commands::calculate_context_stats,
            context::commands::get_context_content,
            context::commands::copy_context_to_clipboard,
            context::commands::save_context_to_file,
            context::commands::has_ignore_files,
            context::commands::get_ignored_by_protocol,
            hyperview::get_file_meta,
            scheduler::update_reminder_config,
            // Refinery Commands
            refinery::commands::get_refinery_history,
            refinery::commands::get_refinery_item_detail,
            refinery::commands::get_refinery_statistics,
            refinery::commands::toggle_refinery_pin,
            refinery::commands::delete_refinery_items,
            refinery::commands::clear_refinery_history,
            refinery::commands::copy_refinery_text,
            refinery::commands::copy_refinery_image,
            refinery::commands::create_note,
            refinery::commands::update_note,
            // Refinery Cleanup Commands (V5)
            refinery::commands::update_cleanup_config,
            refinery::commands::manual_cleanup,
        ])
        .setup(|app| {
            let system = System::new();
            app.manage(Arc::new(Mutex::new(system)));
            app.manage(scheduler::ReminderState(std::sync::Mutex::new(scheduler::ReminderConfig::default())));
            scheduler::start_background_task(app.handle().clone());
            
            match db::init_db(app.handle()) {
                Ok(conn) => {
                    app.manage(db::DbState {
                        conn: Mutex::new(conn),
                    });
                    println!("[Database] SQLite initialized successfully.");
                }
                Err(e) => {
                    panic!("[Database] Critical Error: Failed to initialize database: {}", e);
                }
            }

            // 启动 Refinery Cleanup Worker
            use std::sync::Arc as StdArc;
            use tokio::sync::Mutex as TokioMutex;
            let cleanup_config = StdArc::new(TokioMutex::new(refinery::cleanup_worker::RefineryCleanupConfig::default()));
            app.manage(refinery::commands::CleanupConfigState(cleanup_config.clone()));
            let (cleanup_worker, cleanup_sender) = refinery::cleanup_worker::CleanupWorker::new(cleanup_config);
            tauri::async_runtime::spawn(cleanup_worker.run(app.handle().clone()));

            // 启动 Refinery 监听器，传入 cleanup sender
            refinery::init_listener(app.handle().clone(), Some(cleanup_sender));

            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(if let Some(icon) = app.default_window_icon() {
                    icon.clone()
                } else {
                    return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "No default icon found")));
                })
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|_app, event| match event.id().as_ref() {
                    "quit" => {
                        std::process::exit(0);
                    },
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left, ..
                    } => {
                        ensure_main_window(tray.app_handle());
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                let label = window.label();

                if label == "main" {
                    if window.is_visible().unwrap_or(true) {
                        api.prevent_close();
                        let _ = window.hide();
                        // 注意：自动销毁逻辑已移至前端通过 hide_main_window 命令控制
                    }
                } else if label == "spotlight" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, event| {
            match event {
                RunEvent::ExitRequested { api, .. } => {
                    api.prevent_exit();
                }
                _ => {}
            }
        });
}