use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Runtime, State};
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;

use crate::device::DeviceManager;
use crate::error::{Result, TransferError};
use crate::models::{
    GetChatHistoryRequest, SendFileRequest, SendFileResponse, SendMessageRequest, ServiceConfig,
    ServiceInfo, TransferMessage, TransferNetworkInterface, UrlMode,
};
use crate::network;
use crate::qr;
use crate::server::{self, RunningService, RunningServiceShared};
use crate::transfer::create_file_entry;
use crate::ws::ServerWsMessage;

pub struct TransferState<R: Runtime> {
    coordinator: Arc<Mutex<ServiceCoordinator<R>>>,
    running_flag: AtomicBool,
}

struct ServiceCoordinator<R: Runtime> {
    running: Option<RunningService<R>>,
}

impl<R: Runtime> Default for TransferState<R> {
    fn default() -> Self {
        Self::new()
    }
}

impl<R: Runtime> TransferState<R> {
    pub fn new() -> Self {
        Self {
            coordinator: Arc::new(Mutex::new(ServiceCoordinator { running: None })),
            running_flag: AtomicBool::new(false),
        }
    }

    async fn current_shared(&self) -> Option<RunningServiceShared<R>> {
        self.coordinator
            .lock()
            .await
            .running
            .as_ref()
            .map(|running| running.shared.clone())
    }

    pub async fn is_running(&self) -> bool {
        self.running_flag.load(Ordering::SeqCst)
    }

    pub fn is_running_now(&self) -> bool {
        self.running_flag.load(Ordering::SeqCst)
    }
}

#[tauri::command]
pub async fn start_service<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TransferState<R>>,
    mut config: ServiceConfig,
) -> Result<ServiceInfo> {
    let mut coordinator = state.coordinator.lock().await;
    if coordinator.running.is_some() {
        return Err(TransferError::AlreadyRunning);
    }

    config.save_dir = normalize_optional_text(config.save_dir);
    config.bind_address = normalize_optional_text(config.bind_address);

    let lan_address = network::resolve_lan_address(config.bind_address.as_deref())?;
    eprintln!("[transfer] Resolved LAN address: {lan_address}");

    let (listener, port) = network::bind_listener(&lan_address, config.port).await?;
    eprintln!("[transfer] Server listening on {lan_address}:{port}");

    let route_token = match config.url_mode {
        UrlMode::Random => Some(generate_numeric_token(8)),
        UrlMode::Fixed => None,
    };
    let route_path = route_token
        .as_deref()
        .map(|token| format!("/{token}"))
        .unwrap_or_else(|| "/t".to_string());
    let url = format!("http://{lan_address}:{port}{route_path}");
    eprintln!("[transfer] Service URL: {url}");
    let qr_matrix = qr::build_qr_matrix(&url)?;
    let save_dir = resolve_save_dir(config.save_dir.as_deref())?;
    tokio::fs::create_dir_all(&save_dir).await?;

    let info = ServiceInfo {
        url,
        port,
        bind_address: lan_address.clone(),
        qr_matrix,
        url_mode: config.url_mode.clone(),
        save_dir: save_dir.to_string_lossy().to_string(),
    };

    let shared = RunningServiceShared {
        app,
        config,
        info: info.clone(),
        route_token,
        device_manager: DeviceManager::default(),
        file_registry: Arc::new(RwLock::new(HashMap::new())),
        save_dir: Arc::new(save_dir),
        shutdown: CancellationToken::new(),
    };

    coordinator.running = Some(server::spawn_server(listener, shared));
    state.running_flag.store(true, Ordering::SeqCst);
    Ok(info)
}

#[tauri::command]
pub async fn stop_service<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, TransferState<R>>,
) -> Result<()> {
    let running = {
        let mut coordinator = state.coordinator.lock().await;
        let running = coordinator.running.take();
        if running.is_some() {
            state.running_flag.store(false, Ordering::SeqCst);
        }
        running
    }
    .ok_or(TransferError::NotRunning)?;

    running.shared.shutdown.cancel();
    running.shared.file_registry.write().await.clear();
    running.shared.device_manager.clear().await;
    running.shared.emit(
        server::EVENT_SERVICE_STOPPED,
        &json!({ "reason": "stopped_by_user" }),
    );

    let _ = tokio::time::timeout(Duration::from_secs(2), async move {
        let _ = running.task.await;
    })
    .await;

    Ok(())
}

#[tauri::command]
pub async fn send_message<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, TransferState<R>>,
    request: SendMessageRequest,
) -> Result<()> {
    let shared = state
        .current_shared()
        .await
        .ok_or(TransferError::NotRunning)?;
    let content = request.content.trim();
    if content.is_empty() {
        return Err(TransferError::BadRequest(
            "Message content is empty.".to_string(),
        ));
    }
    if !shared.device_manager.has_device(&request.device_id).await {
        return Err(TransferError::DeviceNotFound(request.device_id));
    }

    let message = TransferMessage::text(
        request.device_id.clone(),
        crate::models::TransferMessageDirection::Sent,
        content.to_string(),
    );
    shared
        .device_manager
        .append_history(&request.device_id, message)
        .await;
    shared
        .device_manager
        .send_json(
            &request.device_id,
            &ServerWsMessage::Chat {
                content: content.to_string(),
                timestamp_ms: crate::models::now_ms(),
            },
        )
        .await?;

    Ok(())
}

#[tauri::command]
pub async fn send_file<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, TransferState<R>>,
    request: SendFileRequest,
) -> Result<SendFileResponse> {
    let shared = state
        .current_shared()
        .await
        .ok_or(TransferError::NotRunning)?;
    if !shared.device_manager.has_device(&request.device_id).await {
        return Err(TransferError::DeviceNotFound(request.device_id));
    }

    let entry = create_file_entry(
        &request.device_id,
        PathBuf::from(&request.file_path).as_path(),
    )?;
    let file_message = TransferMessage::file(
        request.device_id.clone(),
        crate::models::TransferMessageDirection::Sent,
        entry.id.clone(),
        entry.file_name.clone(),
        entry.file_size,
        crate::models::TransferFileStatus::Pending,
    );
    shared
        .device_manager
        .append_history(&request.device_id, file_message)
        .await;
    shared
        .file_registry
        .write()
        .await
        .insert(entry.id.clone(), entry.clone());

    shared
        .device_manager
        .send_json(
            &request.device_id,
            &ServerWsMessage::FileOffer {
                file_id: entry.id.clone(),
                file_name: entry.file_name.clone(),
                file_size: entry.file_size,
                download_url: format!("/api/download/{}", entry.id),
                timestamp_ms: crate::models::now_ms(),
            },
        )
        .await?;

    Ok(SendFileResponse {
        file_id: entry.id,
        file_name: entry.file_name,
        file_size: entry.file_size,
    })
}

#[tauri::command]
pub async fn get_devices<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, TransferState<R>>,
) -> Result<Vec<crate::models::TransferDevice>> {
    let Some(shared) = state.current_shared().await else {
        return Ok(Vec::new());
    };
    Ok(shared.device_manager.list_devices().await)
}

#[tauri::command]
pub async fn get_chat_history<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, TransferState<R>>,
    request: GetChatHistoryRequest,
) -> Result<Vec<TransferMessage>> {
    let Some(shared) = state.current_shared().await else {
        return Ok(Vec::new());
    };
    Ok(shared.device_manager.history(&request.device_id).await)
}

#[tauri::command]
pub async fn get_network_interfaces<R: Runtime>(
    _app: AppHandle<R>,
    _state: State<'_, TransferState<R>>,
) -> Result<Vec<TransferNetworkInterface>> {
    Ok(network::list_network_interfaces())
}

#[tauri::command]
pub async fn respond_file_request<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, TransferState<R>>,
    device_id: String,
    file_id: String,
    accept: bool,
) -> Result<()> {
    let shared = state
        .current_shared()
        .await
        .ok_or(TransferError::NotRunning)?;
    if accept {
        shared
            .device_manager
            .send_json(
                &device_id,
                &ServerWsMessage::FileAccept {
                    file_id: file_id.clone(),
                },
            )
            .await?;
    } else {
        shared
            .device_manager
            .send_json(&device_id, &ServerWsMessage::FileReject { file_id })
            .await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn respond_connection_request<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, TransferState<R>>,
    device_id: String,
    accept: bool,
) -> Result<()> {
    let shared = state
        .current_shared()
        .await
        .ok_or(TransferError::NotRunning)?;
    if accept {
        shared
            .device_manager
            .approve_pending(&device_id)
            .await
            .ok_or(TransferError::DeviceNotFound(device_id))?;
    } else {
        shared.device_manager.reject_pending(&device_id).await;
    }
    Ok(())
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn resolve_save_dir(configured: Option<&str>) -> Result<PathBuf> {
    if let Some(path) = configured {
        return Ok(PathBuf::from(path));
    }

    #[cfg(target_os = "windows")]
    let base = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Downloads");

    #[cfg(not(target_os = "windows"))]
    let base = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Downloads");

    Ok(base.join("CtxRun Transfer"))
}

fn generate_numeric_token(length: usize) -> String {
    let length = length.clamp(1, 19);
    let upper_bound = 10u128.pow(length as u32);
    let value = uuid::Uuid::new_v4().as_u128() % upper_bound;
    format!("{value:0length$}")
}
