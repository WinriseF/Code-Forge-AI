use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tokio::time::sleep;

#[derive(Clone, Debug)]
pub struct ReminderConfig {
    pub enabled: bool,
    pub interval_minutes: u64,
    pub last_triggered: u64,
}

impl Default for ReminderConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_minutes: 45,
            last_triggered: current_timestamp(),
        }
    }
}

pub struct ReminderState(pub Mutex<ReminderConfig>);

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn start_background_task(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            sleep(Duration::from_secs(30)).await;

            let should_notify = {
                let state = app.state::<ReminderState>();
                let mut config = state.0.lock().unwrap();

                if config.enabled {
                    let now = current_timestamp();
                    let elapsed = now.saturating_sub(config.last_triggered);
                    let interval_seconds = config.interval_minutes * 60;

                    if elapsed >= interval_seconds {
                        config.last_triggered = now;
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            };

            if should_notify {
                send_notification(&app);
            }
        }
    });
}

fn send_notification(app: &AppHandle) {
    use tauri_plugin_notification::NotificationExt;

    let interval = {
        let state = app.state::<ReminderState>();
        let config = state.0.lock().unwrap();
        config.interval_minutes
    };

    let result = app.notification()
        .builder()
        .title("Rest Reminder / 休息提醒")
        .body(format!("You've been working for {} minutes. Time to take a break!", interval))
        .show();

    let _ = result;
}

#[tauri::command]
pub fn update_reminder_config(
    state: tauri::State<ReminderState>,
    enabled: bool,
    interval_minutes: u64
) -> Result<(), String> {
    let mut config = state.0.lock().map_err(|e| e.to_string())?;

    if !config.enabled && enabled {
        config.last_triggered = current_timestamp();
    }

    config.enabled = enabled;
    config.interval_minutes = interval_minutes;

    Ok(())
}
