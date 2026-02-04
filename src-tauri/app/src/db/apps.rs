use rusqlite::{params, Connection};
use tauri::State;

use super::init::DbState;
use super::models::AppEntry;

// ============================================================================
// Apps Related Commands
// ============================================================================

#[tauri::command]
pub fn search_apps_in_db(state: State<DbState>, query: String) -> Result<Vec<AppEntry>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let clean_query = format!("%{}%", query.trim());

    let mut stmt = conn.prepare(
        "SELECT name, path, icon, usage_count
         FROM apps
         WHERE name LIKE ?1 OR keywords LIKE ?1
         ORDER BY usage_count DESC, name ASC
         LIMIT 10"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![clean_query], |row| {
        Ok(AppEntry {
            name: row.get(0)?,
            path: row.get(1)?,
            icon: row.get(2)?,
            usage_count: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for r in rows {
        results.push(r.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

#[tauri::command]
pub fn record_app_usage(state: State<DbState>, path: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "UPDATE apps SET usage_count = usage_count + 1, last_used_at = ?1 WHERE path = ?2",
        params![now, path],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// 智能同步 Apps (核心逻辑)
// 传入的是扫描到的最新列表，此函数负责对比差异并更新 DB
pub fn sync_scanned_apps(conn: &Connection, scanned_apps: Vec<AppEntry>) -> Result<usize, rusqlite::Error> {
    let tx = conn.unchecked_transaction()?;

    // 1. 获取数据库中已有的所有路径
    let mut existing_paths = std::collections::HashSet::new();
    {
        let mut stmt = tx.prepare("SELECT path FROM apps")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        for r in rows {
            existing_paths.insert(r?);
        }
    }

    // 2. 准备新扫描到的路径集合
    let mut scanned_paths = std::collections::HashSet::new();
    let mut new_entries = Vec::new();

    for app in &scanned_apps {
        scanned_paths.insert(app.path.clone());
        if !existing_paths.contains(&app.path) {
            new_entries.push(app);
        }
    }

    // 3. 删除：数据库中有，但扫描列表里没有的
    if !scanned_apps.is_empty() {
        for old_path in existing_paths {
            if !scanned_paths.contains(&old_path) {
                tx.execute("DELETE FROM apps WHERE path = ?", params![old_path])?;
            }
        }
    }

    // 4. 新增：插入新发现的应用
    {
        let mut stmt = tx.prepare(
            "INSERT INTO apps (path, name, icon, usage_count) VALUES (?, ?, ?, 0)"
        )?;
        for app in new_entries {
            stmt.execute(params![app.path, app.name, app.icon])?;
        }
    }

    tx.commit()?;
    Ok(scanned_apps.len())
}
