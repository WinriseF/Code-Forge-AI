use tauri::{AppHandle, Runtime, State};

use crate::OcrState;
use crate::error::{OcrServiceError, Result};
use crate::models::{
    OcrRecognitionResponse, OcrRecognizeBytesRequest, OcrRecognizeFileRequest, OcrStatus,
};

#[tauri::command]
pub fn ocr_get_status<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OcrState>,
) -> Result<OcrStatus> {
    state.service().status(&app)
}

#[tauri::command]
pub async fn ocr_prepare<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OcrState>,
) -> Result<OcrStatus> {
    let service = state.service();
    tauri::async_runtime::spawn_blocking(move || service.prepare(&app))
        .await
        .map_err(|err| OcrServiceError::JoinError(err.to_string()))?
}

#[tauri::command]
pub async fn ocr_recognize_file<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OcrState>,
    request: OcrRecognizeFileRequest,
) -> Result<OcrRecognitionResponse> {
    let service = state.service();
    let worker_service = service.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        worker_service.recognize_file(&app, request.path)
    })
    .await
    .map_err(|err| OcrServiceError::JoinError(err.to_string()))?;

    if service.is_loaded() {
        state.ensure_idle_reaper_started();
    }

    result
}

#[tauri::command]
pub async fn ocr_recognize_bytes<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OcrState>,
    request: OcrRecognizeBytesRequest,
) -> Result<OcrRecognitionResponse> {
    let service = state.service();
    let worker_service = service.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        worker_service.recognize_bytes(&app, &request.bytes)
    })
    .await
    .map_err(|err| OcrServiceError::JoinError(err.to_string()))?;

    if service.is_loaded() {
        state.ensure_idle_reaper_started();
    }

    result
}

#[tauri::command]
pub fn ocr_release(state: State<'_, OcrState>) -> bool {
    state.stop_idle_reaper();
    state.service().release()
}
