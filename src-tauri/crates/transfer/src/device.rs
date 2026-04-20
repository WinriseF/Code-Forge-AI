use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use tokio::sync::{RwLock, mpsc, oneshot};

use crate::error::{Result, TransferError};
use crate::models::{
    FileProgressPayload, TransferDevice, TransferFileStatus, TransferMessage,
    TransferMessageDirection,
};

#[derive(Clone, Default)]
pub struct DeviceManager {
    devices: Arc<RwLock<HashMap<String, ConnectedDevice>>>,
    histories: Arc<RwLock<HashMap<String, Vec<TransferMessage>>>>,
    pending: Arc<RwLock<HashMap<String, PendingDevice>>>,
}

#[derive(Clone)]
struct ConnectedDevice {
    device: TransferDevice,
    session_token: String,
    sender: mpsc::UnboundedSender<String>,
}

struct PendingDevice {
    device: TransferDevice,
    approval_tx: oneshot::Sender<bool>,
}

impl DeviceManager {
    pub async fn add_device(
        &self,
        device: TransferDevice,
        session_token: String,
        sender: mpsc::UnboundedSender<String>,
    ) {
        self.histories
            .write()
            .await
            .entry(device.id.clone())
            .or_insert_with(Vec::new);
        self.devices.write().await.insert(
            device.id.clone(),
            ConnectedDevice {
                device,
                session_token,
                sender,
            },
        );
    }

    pub async fn remove_device(&self, device_id: &str) -> Option<TransferDevice> {
        self.devices
            .write()
            .await
            .remove(device_id)
            .map(|entry| entry.device)
    }

    pub async fn list_devices(&self) -> Vec<TransferDevice> {
        let mut devices = self
            .devices
            .read()
            .await
            .values()
            .map(|entry| entry.device.clone())
            .collect::<Vec<_>>();
        devices.sort_by_key(|entry| entry.connected_at_ms);
        devices
    }

    pub async fn has_device(&self, device_id: &str) -> bool {
        self.devices.read().await.contains_key(device_id)
    }

    pub async fn matches_session(&self, device_id: &str, session_token: &str) -> bool {
        self.devices
            .read()
            .await
            .get(device_id)
            .is_some_and(|entry| entry.session_token == session_token)
    }

    pub async fn history(&self, device_id: &str) -> Vec<TransferMessage> {
        self.histories
            .read()
            .await
            .get(device_id)
            .cloned()
            .unwrap_or_default()
    }

    pub async fn append_history(&self, device_id: &str, message: TransferMessage) {
        let mut histories = self.histories.write().await;
        histories
            .entry(device_id.to_string())
            .or_insert_with(Vec::new)
            .push(message);
    }

    pub async fn send_json<T>(&self, device_id: &str, payload: &T) -> Result<()>
    where
        T: Serialize,
    {
        let json = serde_json::to_string(payload)?;
        let sender = self
            .devices
            .read()
            .await
            .get(device_id)
            .map(|entry| entry.sender.clone())
            .ok_or_else(|| TransferError::DeviceNotFound(device_id.to_string()))?;
        sender
            .send(json)
            .map_err(|_| TransferError::DeviceNotFound(device_id.to_string()))
    }

    pub async fn upsert_file_progress(&self, payload: &FileProgressPayload) {
        let mut histories = self.histories.write().await;
        let entries = histories
            .entry(payload.device_id.clone())
            .or_insert_with(Vec::new);
        if let Some(message) = entries
            .iter_mut()
            .find(|entry| entry.file_id.as_deref() == Some(payload.file_id.as_str()))
        {
            message.progress_percent = Some(payload.progress_percent);
            message.status = Some(payload.status.clone());
            if let Some(saved_path) = &payload.saved_path {
                message.saved_path = Some(saved_path.clone());
            }
            return;
        }

        let mut message = TransferMessage::file(
            payload.device_id.clone(),
            payload.direction.clone(),
            payload.file_id.clone(),
            payload.file_name.clone(),
            payload.total_bytes,
            payload.status.clone(),
        );
        message.progress_percent = Some(payload.progress_percent);
        message.saved_path = payload.saved_path.clone();
        entries.push(message);
    }

    pub async fn fail_file(&self, device_id: &str, file_id: &str) {
        let mut histories = self.histories.write().await;
        let Some(entries) = histories.get_mut(device_id) else {
            return;
        };

        if let Some(message) = entries
            .iter_mut()
            .find(|entry| entry.file_id.as_deref() == Some(file_id))
        {
            message.status = Some(TransferFileStatus::Failed);
        }
    }

    pub async fn add_pending(&self, device: TransferDevice) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        self.pending.write().await.insert(
            device.id.clone(),
            PendingDevice {
                device,
                approval_tx: tx,
            },
        );
        rx
    }

    pub async fn approve_pending(&self, device_id: &str) -> Option<TransferDevice> {
        self.pending.write().await.remove(device_id).map(|pending| {
            let _ = pending.approval_tx.send(true);
            pending.device
        })
    }

    pub async fn reject_pending(&self, device_id: &str) -> bool {
        self.pending
            .write()
            .await
            .remove(device_id)
            .map(|pending| {
                let _ = pending.approval_tx.send(false);
            })
            .is_some()
    }

    pub async fn remove_pending(&self, device_id: &str) -> Option<TransferDevice> {
        self.pending
            .write()
            .await
            .remove(device_id)
            .map(|pending| pending.device)
    }

    pub async fn clear(&self) {
        self.devices.write().await.clear();
        self.histories.write().await.clear();
        self.pending.write().await.clear();
    }

    pub async fn get_device(&self, device_id: &str) -> Option<TransferDevice> {
        self.devices
            .read()
            .await
            .get(device_id)
            .map(|entry| entry.device.clone())
    }
}

pub fn infer_device_type(user_agent: &str) -> String {
    let lower = user_agent.to_lowercase();
    if lower.contains("ipad") || lower.contains("tablet") {
        return "tablet".to_string();
    }
    if lower.contains("iphone") {
        return "ios".to_string();
    }
    if lower.contains("android") {
        return "android".to_string();
    }
    "desktop".to_string()
}

pub fn infer_device_name(user_agent: &str) -> String {
    let lower = user_agent.to_lowercase();
    let os = if lower.contains("iphone") {
        "iPhone"
    } else if lower.contains("ipad") {
        "iPad"
    } else if lower.contains("android") {
        "Android"
    } else if lower.contains("windows") {
        "Windows"
    } else if lower.contains("mac os") || lower.contains("macintosh") {
        "macOS"
    } else if lower.contains("linux") {
        "Linux"
    } else {
        "Device"
    };

    let browser = if lower.contains("edg/") {
        "Edge"
    } else if lower.contains("chrome/") && !lower.contains("edg/") {
        "Chrome"
    } else if lower.contains("safari/") && !lower.contains("chrome/") {
        "Safari"
    } else if lower.contains("firefox/") {
        "Firefox"
    } else {
        "Browser"
    };

    format!("{os} {browser}")
}

#[allow(dead_code)]
pub fn direction_is_incoming(direction: &TransferMessageDirection) -> bool {
    matches!(direction, TransferMessageDirection::Received)
}
