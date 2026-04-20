use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

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
    sessions: Arc<RwLock<HashMap<String, SessionRecord>>>,
}

#[derive(Clone)]
struct ConnectedDevice {
    device: TransferDevice,
    sender: mpsc::UnboundedSender<String>,
    connection_id: String,
}

#[derive(Clone)]
struct SessionRecord {
    device: TransferDevice,
    session_token: String,
    disconnect_deadline: Option<Instant>,
    active_connection_id: Option<String>,
}

struct PendingDevice {
    device: TransferDevice,
    approval_tx: oneshot::Sender<bool>,
}

const SESSION_RESUME_GRACE_PERIOD: Duration = Duration::from_secs(180);

impl DeviceManager {
    pub async fn add_device(
        &self,
        device: TransferDevice,
        session_token: String,
        sender: mpsc::UnboundedSender<String>,
    ) -> String {
        self.prune_expired_sessions().await;
        let connection_id = uuid::Uuid::new_v4().simple().to_string();
        self.histories
            .write()
            .await
            .entry(device.id.clone())
            .or_insert_with(Vec::new);
        self.sessions.write().await.insert(
            device.id.clone(),
            SessionRecord {
                device: device.clone(),
                session_token,
                disconnect_deadline: None,
                active_connection_id: Some(connection_id.clone()),
            },
        );
        self.devices.write().await.insert(
            device.id.clone(),
            ConnectedDevice {
                device,
                sender,
                connection_id: connection_id.clone(),
            },
        );
        connection_id
    }

    pub async fn remove_device(
        &self,
        device_id: &str,
        connection_id: &str,
    ) -> Option<TransferDevice> {
        let removed = {
            let mut devices = self.devices.write().await;
            let should_remove = devices
                .get(device_id)
                .is_some_and(|entry| entry.connection_id == connection_id);
            if should_remove {
                devices.remove(device_id).map(|entry| entry.device)
            } else {
                None
            }
        };

        if let Some(device) = &removed
            && let Some(session) = self.sessions.write().await.get_mut(device_id)
            && session.active_connection_id.as_deref() == Some(connection_id)
        {
            session.device = device.clone();
            session.disconnect_deadline = Some(Instant::now() + SESSION_RESUME_GRACE_PERIOD);
            session.active_connection_id = None;
        }

        removed
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

    pub async fn validate_session(
        &self,
        device_id: &str,
        session_token: &str,
        ip_address: &str,
    ) -> bool {
        self.prune_expired_sessions().await;
        self.sessions
            .read()
            .await
            .get(device_id)
            .is_some_and(|entry| {
                entry.session_token == session_token && entry.device.ip_address == ip_address
            })
    }

    pub async fn resume_session(
        &self,
        device_id: &str,
        session_token: &str,
        ip_address: &str,
        sender: mpsc::UnboundedSender<String>,
    ) -> Option<(TransferDevice, String)> {
        self.prune_expired_sessions().await;

        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(device_id)?;
        if session.session_token != session_token || session.device.ip_address != ip_address {
            return None;
        }

        session.disconnect_deadline = None;
        let connection_id = uuid::Uuid::new_v4().simple().to_string();
        session.active_connection_id = Some(connection_id.clone());
        let device = session.device.clone();
        drop(sessions);

        self.histories
            .write()
            .await
            .entry(device_id.to_string())
            .or_insert_with(Vec::new);
        self.devices.write().await.insert(
            device_id.to_string(),
            ConnectedDevice {
                device: device.clone(),
                sender,
                connection_id: connection_id.clone(),
            },
        );

        Some((device, connection_id))
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
        self.sessions.write().await.clear();
    }

    pub async fn get_device(&self, device_id: &str) -> Option<TransferDevice> {
        self.devices
            .read()
            .await
            .get(device_id)
            .map(|entry| entry.device.clone())
    }

    async fn prune_expired_sessions(&self) {
        let now = Instant::now();
        let has_expired = self.sessions.read().await.values().any(|session| {
            session
                .disconnect_deadline
                .is_some_and(|deadline| deadline <= now)
        });
        if !has_expired {
            return;
        }

        self.sessions.write().await.retain(|_, session| {
            session
                .disconnect_deadline
                .is_none_or(|deadline| deadline > now)
        });
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

#[cfg(test)]
mod tests {
    use tokio::sync::mpsc;

    use super::*;

    fn test_device(device_id: &str) -> TransferDevice {
        TransferDevice {
            id: device_id.to_string(),
            name: "Android Chrome".to_string(),
            device_type: "android".to_string(),
            ip_address: "192.168.1.23".to_string(),
            connected_at_ms: 1,
        }
    }

    #[tokio::test]
    async fn session_survives_short_disconnect_and_can_resume() {
        let manager = DeviceManager::default();
        let device = test_device("device-1");
        let (sender, _rx) = mpsc::unbounded_channel();

        let connection_id = manager
            .add_device(device.clone(), "token-1".to_string(), sender)
            .await;
        assert!(
            manager
                .validate_session(&device.id, "token-1", &device.ip_address)
                .await
        );

        let removed = manager.remove_device(&device.id, &connection_id).await;
        assert_eq!(
            removed.as_ref().map(|item| item.id.as_str()),
            Some("device-1")
        );
        assert!(
            manager
                .validate_session(&device.id, "token-1", &device.ip_address)
                .await
        );

        let (sender, _rx) = mpsc::unbounded_channel();
        let resumed = manager
            .resume_session(&device.id, "token-1", &device.ip_address, sender)
            .await;
        assert_eq!(
            resumed.as_ref().map(|(item, _)| item.id.as_str()),
            Some("device-1")
        );
        assert!(manager.has_device(&device.id).await);
    }

    #[tokio::test]
    async fn stale_connection_cleanup_does_not_remove_new_socket() {
        let manager = DeviceManager::default();
        let device = test_device("device-2");
        let (sender, _rx) = mpsc::unbounded_channel();

        let first_connection_id = manager
            .add_device(device.clone(), "token-2".to_string(), sender)
            .await;
        let removed = manager
            .remove_device(&device.id, &first_connection_id)
            .await;
        assert!(removed.is_some());

        let (sender, _rx) = mpsc::unbounded_channel();
        let (_, resumed_connection_id) = manager
            .resume_session(&device.id, "token-2", &device.ip_address, sender)
            .await
            .expect("session should resume");

        let stale_cleanup = manager
            .remove_device(&device.id, &first_connection_id)
            .await;
        assert!(stale_cleanup.is_none());
        assert!(manager.has_device(&device.id).await);

        let latest_cleanup = manager
            .remove_device(&device.id, &resumed_connection_id)
            .await;
        assert!(latest_cleanup.is_some());
    }

    #[tokio::test]
    async fn expired_session_cannot_be_reused() {
        let manager = DeviceManager::default();
        let device = test_device("device-3");
        let (sender, _rx) = mpsc::unbounded_channel();

        let connection_id = manager
            .add_device(device.clone(), "token-3".to_string(), sender)
            .await;
        let removed = manager.remove_device(&device.id, &connection_id).await;
        assert!(removed.is_some());

        {
            let mut sessions = manager.sessions.write().await;
            let session = sessions
                .get_mut(&device.id)
                .expect("session should exist after disconnect");
            session.disconnect_deadline = Some(Instant::now() - Duration::from_secs(1));
        }

        assert!(
            !manager
                .validate_session(&device.id, "token-3", &device.ip_address)
                .await
        );

        let (sender, _rx) = mpsc::unbounded_channel();
        let resumed = manager
            .resume_session(&device.id, "token-3", &device.ip_address, sender)
            .await;
        assert!(resumed.is_none());
    }

    #[tokio::test]
    async fn resume_fails_when_ip_does_not_match() {
        let manager = DeviceManager::default();
        let device = test_device("device-4");
        let (sender, _rx) = mpsc::unbounded_channel();

        let connection_id = manager
            .add_device(device.clone(), "token-4".to_string(), sender)
            .await;
        let removed = manager.remove_device(&device.id, &connection_id).await;
        assert!(removed.is_some());

        let (sender, _rx) = mpsc::unbounded_channel();
        let resumed = manager
            .resume_session(&device.id, "token-4", "192.168.1.99", sender)
            .await;
        assert!(resumed.is_none());
        assert!(
            !manager
                .validate_session(&device.id, "token-4", "192.168.1.99")
                .await
        );
    }

    #[tokio::test]
    async fn resume_fails_when_token_does_not_match() {
        let manager = DeviceManager::default();
        let device = test_device("device-5");
        let (sender, _rx) = mpsc::unbounded_channel();

        let connection_id = manager
            .add_device(device.clone(), "token-5".to_string(), sender)
            .await;
        let removed = manager.remove_device(&device.id, &connection_id).await;
        assert!(removed.is_some());

        let (sender, _rx) = mpsc::unbounded_channel();
        let resumed = manager
            .resume_session(&device.id, "wrong-token", &device.ip_address, sender)
            .await;
        assert!(resumed.is_none());
        assert!(
            !manager
                .validate_session(&device.id, "wrong-token", &device.ip_address)
                .await
        );
    }

    #[tokio::test]
    async fn clear_removes_sessions_and_devices() {
        let manager = DeviceManager::default();
        let device = test_device("device-6");
        let (sender, _rx) = mpsc::unbounded_channel();

        let _ = manager
            .add_device(device.clone(), "token-6".to_string(), sender)
            .await;
        assert!(
            manager
                .validate_session(&device.id, "token-6", &device.ip_address)
                .await
        );

        manager.clear().await;

        assert!(!manager.has_device(&device.id).await);
        assert!(
            !manager
                .validate_session(&device.id, "token-6", &device.ip_address)
                .await
        );
    }
}
