use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};
use tauri::AppHandle;
use serde::{Deserialize, Serialize};

/// 定期扫描间隔：1 小时
const SCAN_INTERVAL_SECS: u64 = 3600;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefineryCleanupConfig {
    pub enabled: bool,
    pub strategy: String,      // "time" | "count" | "both"
    pub days: Option<u32>,
    pub max_count: Option<u32>,
    pub keep_pinned: bool,
}

impl Default for RefineryCleanupConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            strategy: "count".to_string(),
            days: Some(30),
            max_count: Some(1000),
            keep_pinned: true,
        }
    }
}

pub struct CleanupWorker {
    config: Arc<Mutex<RefineryCleanupConfig>>,
    rx: mpsc::Receiver<()>,
}

impl CleanupWorker {
    pub fn new(config: Arc<Mutex<RefineryCleanupConfig>>) -> (Self, mpsc::Sender<()>) {
        let (tx, rx) = mpsc::channel(100);
        (
            Self { config, rx },
            tx,
        )
    }

    pub async fn run(mut self, app: AppHandle) {
        loop {
            tokio::select! {
                // 接收到剪贴板捕获消息
                Some(_) = self.rx.recv() => {
                    self.check_and_cleanup(&app);
                }
                // 定期扫描（每小时）
                _ = tokio::time::sleep(Duration::from_secs(SCAN_INTERVAL_SECS)) => {
                    self.check_and_cleanup(&app);
                }
            }
        }
    }

    fn check_and_cleanup(&self, app: &AppHandle) {
        let config = self.config.blocking_lock().clone();

        if !config.enabled {
            return;
        }

        match config.strategy.as_str() {
            "count" => {
                if let Some(max_count) = config.max_count {
                    if let Err(e) = super::commands::execute_count_cleanup(app, max_count, config.keep_pinned) {
                        eprintln!("[Refinery Cleanup] Count cleanup failed: {}", e);
                    }
                }
            }
            "time" => {
                if let Some(days) = config.days {
                    if let Err(e) = super::commands::execute_time_cleanup(app, days, config.keep_pinned) {
                        eprintln!("[Refinery Cleanup] Time cleanup failed: {}", e);
                    }
                }
            }
            "both" => {
                let count_triggered = if let Some(max_count) = config.max_count {
                    super::commands::execute_count_cleanup(app, max_count, config.keep_pinned).unwrap_or(0) > 0
                } else {
                    false
                };

                if !count_triggered {
                    if let Some(days) = config.days {
                        let _ = super::commands::execute_time_cleanup(app, days, config.keep_pinned);
                    }
                }
            }
            _ => {}
        }
    }
}
