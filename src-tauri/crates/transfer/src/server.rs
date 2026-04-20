use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Multipart, Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Router, serve};
use serde::Serialize;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tokio_util::io::ReaderStream;
use tokio_util::sync::CancellationToken;

use crate::device::DeviceManager;
use crate::error::{Result, TransferError};
use crate::mobile::render_mobile_page;
use crate::models::{
    ErrorPayload, FileProgressPayload, ServiceConfig, ServiceInfo, TransferFileStatus,
    TransferMessage, TransferMessageDirection,
};
use crate::transfer::{FileEntry, build_content_disposition, resolve_save_path};
use crate::ws;

pub const EVENT_DEVICE_CONNECTED: &str = "transfer:device-connected";
pub const EVENT_DEVICE_DISCONNECTED: &str = "transfer:device-disconnected";
pub const EVENT_CONNECTION_REQUEST: &str = "transfer:connection-request";
pub const EVENT_CONNECTION_REQUEST_CANCELLED: &str = "transfer:connection-request-cancelled";
pub const EVENT_MESSAGE_RECEIVED: &str = "transfer:message-received";
pub const EVENT_FILE_RECEIVED: &str = "transfer:file-received";
pub const EVENT_FILE_PROGRESS: &str = "transfer:file-progress";
pub const EVENT_SERVICE_STOPPED: &str = "transfer:service-stopped";
pub const EVENT_ERROR: &str = "transfer:error";
pub const SESSION_COOKIE_NAME: &str = "ctxrun_transfer_session";

pub struct RunningServiceShared<R: Runtime> {
    pub app: AppHandle<R>,
    pub config: ServiceConfig,
    pub info: ServiceInfo,
    pub route_token: Option<String>,
    pub device_manager: DeviceManager,
    pub file_registry: Arc<RwLock<HashMap<String, FileEntry>>>,
    pub save_dir: Arc<PathBuf>,
    pub shutdown: CancellationToken,
}

impl<R: Runtime> Clone for RunningServiceShared<R> {
    fn clone(&self) -> Self {
        Self {
            app: self.app.clone(),
            config: self.config.clone(),
            info: self.info.clone(),
            route_token: self.route_token.clone(),
            device_manager: self.device_manager.clone(),
            file_registry: self.file_registry.clone(),
            save_dir: self.save_dir.clone(),
            shutdown: self.shutdown.clone(),
        }
    }
}

pub struct RunningService<R: Runtime> {
    pub shared: RunningServiceShared<R>,
    pub task: JoinHandle<()>,
}

impl<R: Runtime> RunningServiceShared<R> {
    pub fn emit<S: Serialize>(&self, event: &str, payload: &S) {
        let _ = self.app.emit(event, payload);
    }

    pub fn ws_path(&self) -> String {
        self.route_token
            .as_deref()
            .map(|token| format!("/{token}/ws"))
            .unwrap_or_else(|| "/ws".to_string())
    }
}

pub fn spawn_server<R: Runtime>(
    listener: TcpListener,
    shared: RunningServiceShared<R>,
) -> RunningService<R> {
    let task_shared = shared.clone();
    let task = tauri::async_runtime::spawn(async move {
        let router = build_router(task_shared.clone());
        let server = serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        );
        let _ = server
            .with_graceful_shutdown(async move {
                task_shared.shutdown.cancelled().await;
            })
            .await;
    });

    RunningService { shared, task }
}

fn build_router<R: Runtime>(shared: RunningServiceShared<R>) -> Router {
    Router::new()
        .route("/", get(root_page::<R>))
        .route("/t", get(fixed_page::<R>))
        .route("/ws", get(ws_upgrade::<R>))
        .route("/api/upload/{device_id}", post(upload_handler::<R>))
        .route("/api/download/{file_id}", get(download_handler::<R>))
        .route("/favicon.ico", get(favicon_handler))
        .route("/{token}", get(token_page::<R>))
        .route("/{token}/ws", get(token_ws_upgrade::<R>))
        .layer(DefaultBodyLimit::disable())
        .with_state(shared)
}

async fn favicon_handler() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn root_page<R: Runtime>(
    State(shared): State<RunningServiceShared<R>>,
) -> Result<Html<String>> {
    if shared.route_token.is_some() {
        return Err(TransferError::InvalidRouteToken);
    }
    Ok(Html(render_mobile_page(&shared.ws_path())))
}

async fn fixed_page<R: Runtime>(
    State(shared): State<RunningServiceShared<R>>,
) -> Result<Html<String>> {
    if shared.route_token.is_some() {
        return Err(TransferError::InvalidRouteToken);
    }
    Ok(Html(render_mobile_page(&shared.ws_path())))
}

async fn token_page<R: Runtime>(
    Path(token): Path<String>,
    State(shared): State<RunningServiceShared<R>>,
) -> Result<Html<String>> {
    validate_route_token(shared.route_token.as_deref(), Some(token.as_str()))?;
    Ok(Html(render_mobile_page(&shared.ws_path())))
}

async fn ws_upgrade<R: Runtime>(
    ws: WebSocketUpgrade,
    State(shared): State<RunningServiceShared<R>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Result<impl IntoResponse> {
    if shared.route_token.is_some() {
        return Err(TransferError::InvalidRouteToken);
    }
    eprintln!("[transfer] WS upgrade request from {}", addr);
    Ok(ws.on_upgrade(move |socket| ws::handle_socket(socket, shared, addr.ip().to_string())))
}

async fn token_ws_upgrade<R: Runtime>(
    Path(token): Path<String>,
    ws: WebSocketUpgrade,
    State(shared): State<RunningServiceShared<R>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Result<impl IntoResponse> {
    validate_route_token(shared.route_token.as_deref(), Some(token.as_str()))?;
    eprintln!("[transfer] WS upgrade request (token route) from {}", addr);
    Ok(ws.on_upgrade(move |socket| ws::handle_socket(socket, shared, addr.ip().to_string())))
}

async fn download_handler<R: Runtime>(
    Path(file_id): Path<String>,
    State(shared): State<RunningServiceShared<R>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Response> {
    let entry = shared
        .file_registry
        .read()
        .await
        .get(&file_id)
        .cloned()
        .ok_or_else(|| TransferError::FileNotFound(file_id.clone()))?;

    validate_session(&shared, &headers, &entry.device_id, addr).await?;

    let file = tokio::fs::File::open(&entry.path).await?;
    let body = Body::from_stream(ReaderStream::new(file));
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(
            header::CONTENT_DISPOSITION,
            build_content_disposition(&entry.file_name),
        )
        .body(body)
        .map_err(|error| {
            TransferError::Message(format!("Failed to build download response: {error}"))
        })
}

async fn upload_handler<R: Runtime>(
    Path(device_id): Path<String>,
    State(shared): State<RunningServiceShared<R>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<StatusCode> {
    validate_session(&shared, &headers, &device_id, addr).await?;

    let upload_size_hint = headers
        .get("x-ctxrun-file-size")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());

    let mut saved_any = false;
    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|error| TransferError::BadRequest(format!("Invalid multipart body: {error}")))?
    {
        let Some(file_name) = field.file_name().map(ToOwned::to_owned) else {
            continue;
        };
        let output_path = resolve_save_path(shared.save_dir.as_path(), &file_name)?;
        let mut output = tokio::fs::File::create(&output_path).await?;
        let file_id = headers
            .get("x-ctxrun-file-id")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .unwrap_or_else(|| generate_token(16));
        let started_at = Instant::now();
        let mut written = 0u64;
        let mut last_emit = Instant::now();

        while let Some(chunk) = field.chunk().await.map_err(|error| {
            TransferError::BadRequest(format!("Failed to read upload chunk: {error}"))
        })? {
            output.write_all(&chunk).await?;
            written += chunk.len() as u64;

            if let Some(total_bytes) = upload_size_hint
                && total_bytes > 0
                && last_emit.elapsed() >= Duration::from_millis(100)
            {
                emit_upload_progress(UploadProgress {
                    shared: &shared,
                    device_id: &device_id,
                    file_id: &file_id,
                    file_name: &file_name,
                    transferred_bytes: written,
                    total_bytes,
                    status: TransferFileStatus::Transferring,
                    saved_path: None,
                    started_at,
                })
                .await;
                last_emit = Instant::now();
            }
        }

        output.flush().await?;
        let saved_path = output_path.to_string_lossy().to_string();
        let mut message = TransferMessage::file(
            device_id.clone(),
            TransferMessageDirection::Received,
            file_id.clone(),
            file_name.clone(),
            written,
            TransferFileStatus::Completed,
        );
        message.saved_path = Some(saved_path.clone());
        message.progress_percent = Some(100.0);
        shared
            .device_manager
            .append_history(&device_id, message.clone())
            .await;
        shared.emit(EVENT_FILE_RECEIVED, &message);

        emit_upload_progress(UploadProgress {
            shared: &shared,
            device_id: &device_id,
            file_id: &file_id,
            file_name: &file_name,
            transferred_bytes: written,
            total_bytes: upload_size_hint.unwrap_or(written).max(written),
            status: TransferFileStatus::Completed,
            saved_path: Some(saved_path),
            started_at,
        })
        .await;
        saved_any = true;
    }

    if !saved_any {
        return Err(TransferError::BadRequest(
            "No file was provided in the upload body.".to_string(),
        ));
    }

    Ok(StatusCode::OK)
}

struct UploadProgress<'a, R: Runtime> {
    shared: &'a RunningServiceShared<R>,
    device_id: &'a str,
    file_id: &'a str,
    file_name: &'a str,
    transferred_bytes: u64,
    total_bytes: u64,
    status: TransferFileStatus,
    saved_path: Option<String>,
    started_at: Instant,
}

async fn emit_upload_progress<R: Runtime>(args: UploadProgress<'_, R>) {
    let UploadProgress {
        shared,
        device_id,
        file_id,
        file_name,
        transferred_bytes,
        total_bytes,
        status,
        saved_path,
        started_at,
    } = args;
    let elapsed_secs = started_at.elapsed().as_secs_f64().max(0.001);
    let payload = FileProgressPayload {
        device_id: device_id.to_string(),
        file_id: file_id.to_string(),
        file_name: file_name.to_string(),
        direction: TransferMessageDirection::Received,
        status,
        transferred_bytes,
        total_bytes,
        progress_percent: ((transferred_bytes as f64 / total_bytes.max(1) as f64) * 100.0)
            .min(100.0) as f32,
        speed_bytes_per_sec: (transferred_bytes as f64 / elapsed_secs) as u64,
        saved_path,
    };
    shared.emit(EVENT_FILE_PROGRESS, &payload);
}

fn validate_route_token(expected: Option<&str>, actual: Option<&str>) -> Result<()> {
    match (expected, actual) {
        (Some(expected), Some(actual)) if expected == actual => Ok(()),
        (None, None) => Ok(()),
        _ => Err(TransferError::InvalidRouteToken),
    }
}

fn extract_session_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value.split(';').find_map(|cookie| {
                let (name, token) = cookie.trim().split_once('=')?;
                (name == SESSION_COOKIE_NAME).then(|| token.to_string())
            })
        })
}

fn generate_token(length: usize) -> String {
    let raw = uuid::Uuid::new_v4().simple().to_string();
    raw[..length.min(raw.len())].to_string()
}

async fn validate_session<R: Runtime>(
    shared: &RunningServiceShared<R>,
    headers: &HeaderMap,
    device_id: &str,
    addr: SocketAddr,
) -> Result<()> {
    let session_token = extract_session_token(headers).ok_or(TransferError::InvalidSession)?;
    if !shared
        .device_manager
        .matches_session(device_id, &session_token)
        .await
    {
        return Err(TransferError::InvalidSession);
    }

    let device = shared
        .device_manager
        .get_device(device_id)
        .await
        .ok_or_else(|| TransferError::DeviceNotFound(device_id.to_string()))?;

    if device.ip_address != addr.ip().to_string() {
        return Err(TransferError::InvalidSession);
    }

    Ok(())
}

pub fn emit_error<R: Runtime>(
    shared: &RunningServiceShared<R>,
    message: impl Into<String>,
    device_id: Option<String>,
) {
    shared.emit(
        EVENT_ERROR,
        &ErrorPayload {
            message: message.into(),
            device_id,
        },
    );
}
