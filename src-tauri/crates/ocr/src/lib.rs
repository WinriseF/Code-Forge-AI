use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::async_runtime::JoinHandle;
use tauri::{
    Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};
use tokio::time::{Instant, MissedTickBehavior, interval_at};

pub mod commands;
pub mod download;
pub mod error;
pub mod models;
pub mod paths;
pub mod service;
mod utils;

use service::{IdleReaperAction, OcrService};
use utils::lock_recover;

pub use error::{OcrServiceError, Result};

struct IdleReaperTask {
    running: Arc<AtomicBool>,
    join_handle: JoinHandle<()>,
}

struct RunningFlagGuard {
    running: Arc<AtomicBool>,
}

impl RunningFlagGuard {
    fn new(running: Arc<AtomicBool>) -> Self {
        Self { running }
    }
}

impl Drop for RunningFlagGuard {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Release);
    }
}

impl IdleReaperTask {
    fn spawn(service: OcrService) -> Self {
        let running = Arc::new(AtomicBool::new(true));
        let running_flag = Arc::clone(&running);
        let interval = normalize_interval(service.idle_reaper_interval());
        let join_handle = tauri::async_runtime::spawn(async move {
            let _running_guard = RunningFlagGuard::new(running_flag);
            let mut ticker = interval_at(Instant::now() + interval, interval);
            ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);

            loop {
                ticker.tick().await;
                if matches!(service.idle_reaper_tick(), IdleReaperAction::Stop) {
                    break;
                }
            }
        });

        Self {
            running,
            join_handle,
        }
    }

    fn is_running(&self) -> bool {
        self.running.load(Ordering::Acquire)
    }
}

impl Drop for IdleReaperTask {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Release);
        self.join_handle.abort();
    }
}

pub struct OcrState {
    service: OcrService,
    idle_reaper: Mutex<Option<IdleReaperTask>>,
}

impl OcrState {
    pub fn new() -> Self {
        let service = OcrService::new();
        Self {
            service,
            idle_reaper: Mutex::new(None),
        }
    }

    pub fn ensure_idle_reaper_started(&self) {
        if !self.service.is_loaded() {
            return;
        }

        let mut idle_reaper = lock_recover(&self.idle_reaper);
        if idle_reaper.as_ref().is_some_and(IdleReaperTask::is_running) {
            return;
        }

        idle_reaper.take();
        *idle_reaper = Some(IdleReaperTask::spawn(self.service.clone()));
    }

    pub fn stop_idle_reaper(&self) {
        lock_recover(&self.idle_reaper).take();
    }

    pub fn service(&self) -> OcrService {
        self.service.clone()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("ctxrun-plugin-ocr")
        .invoke_handler(tauri::generate_handler![
            commands::ocr_get_status,
            commands::ocr_prepare,
            commands::ocr_recognize_file,
            commands::ocr_recognize_bytes,
            commands::ocr_release
        ])
        .setup(|app, _api| {
            app.manage(OcrState::new());
            Ok(())
        })
        .build()
}

fn normalize_interval(interval: Duration) -> Duration {
    if interval.is_zero() {
        Duration::from_millis(1)
    } else {
        interval
    }
}
