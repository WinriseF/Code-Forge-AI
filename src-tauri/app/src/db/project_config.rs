use rusqlite::params;
use tauri::State;

use super::init::DbState;
use super::models::{ProjectConfig, ProjectConfigExportItem};

use std::fs::File;
use std::io::Write;

// ============================================================================
// Project Memory Feature Commands
// ============================================================================

#[tauri::command]
pub fn get_project_config(
    state: State<DbState>,
    path: String,
) -> Result<Option<ProjectConfig>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT config FROM project_configs WHERE path = ?").map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![path]).map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let config_json: String = row.get(0).map_err(|e| e.to_string())?;
        let config: ProjectConfig = serde_json::from_str(&config_json)
            .map_err(|e| format!("Config parse error: {}", e))?;
        Ok(Some(config))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn save_project_config(
    state: State<DbState>,
    path: String,
    config: ProjectConfig,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO project_configs (path, config, updated_at) VALUES (?1, ?2, ?3)",
        params![path, config_json, now],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

// ============================================================================
// Export/Import Project Configs
// ============================================================================

#[tauri::command]
pub fn export_project_configs(
    state: State<DbState>,
    save_path: String,
) -> Result<usize, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT path, config, updated_at FROM project_configs").map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        let path: String = row.get(0)?;
        let config_str: String = row.get(1)?;
        let updated_at: i64 = row.get(2)?;

        let config: ProjectConfig = serde_json::from_str(&config_str)
            .unwrap_or(ProjectConfig { dirs: vec![], files: vec![], extensions: vec![] });

        Ok(ProjectConfigExportItem {
            path,
            config,
            updated_at,
        })
    }).map_err(|e| e.to_string())?;

    let mut export_list = Vec::new();
    for row in rows {
        export_list.push(row.map_err(|e| e.to_string())?);
    }

    let json_content = serde_json::to_string_pretty(&export_list).map_err(|e| e.to_string())?;

    let mut file = File::create(save_path).map_err(|e| e.to_string())?;
    file.write_all(json_content.as_bytes()).map_err(|e| e.to_string())?;

    Ok(export_list.len())
}

#[tauri::command]
pub fn import_project_configs(
    state: State<DbState>,
    file_path: String,
    mode: String,
) -> Result<usize, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;

    let content = std::fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let import_list: Vec<ProjectConfigExportItem> = serde_json::from_str(&content)
        .map_err(|e| format!("JSON format error: {}", e))?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    if mode == "overwrite" {
        tx.execute("DELETE FROM project_configs", []).map_err(|e| e.to_string())?;
    }

    let mut count = 0;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO project_configs (path, config, updated_at) VALUES (?1, ?2, ?3)"
        ).map_err(|e| e.to_string())?;

        for item in import_list {
            let config_json = serde_json::to_string(&item.config).unwrap_or("{}".to_string());

            stmt.execute(params![
                item.path,
                config_json,
                item.updated_at
            ]).map_err(|e| e.to_string())?;

            count += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(count)
}
