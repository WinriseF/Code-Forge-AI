use rusqlite::params;
use tauri::State;

use super::init::DbState;
use super::models::ShellHistoryEntry;

// ============================================================================
// Shell History Feature
// ============================================================================

#[tauri::command]
pub fn record_shell_command(state: State<'_, DbState>, command: String) -> Result<(), String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT INTO shell_history (command, timestamp, execution_count)
         VALUES (?1, ?2, 1)
         ON CONFLICT(command) DO UPDATE SET
           execution_count = execution_count + 1,
           timestamp = ?2",
        params![trimmed, now],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_recent_shell_history(state: State<'_, DbState>, limit: u32) -> Result<Vec<ShellHistoryEntry>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, command, timestamp, execution_count
         FROM shell_history
         ORDER BY timestamp DESC
         LIMIT ?1"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![limit], |row| {
        Ok(ShellHistoryEntry {
            id: row.get(0)?,
            command: row.get(1)?,
            timestamp: row.get(2)?,
            execution_count: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for entry in rows {
        entries.push(entry.map_err(|e| e.to_string())?);
    }

    Ok(entries)
}

#[tauri::command]
pub fn search_shell_history(state: State<'_, DbState>, query: String, limit: u32) -> Result<Vec<ShellHistoryEntry>, String> {
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return get_recent_shell_history(state, limit);
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let keywords: Vec<&str> = trimmed_query.split_whitespace().collect();
    let now = chrono::Utc::now().timestamp();

    let mut sql = String::from(
        "SELECT *,
        (
            (CASE WHEN command LIKE ?1 THEN 100 ELSE 0 END) +
            (CASE WHEN command LIKE ?2 THEN 80 ELSE 0 END) +
            (CASE WHEN command LIKE ?3 THEN 60 ELSE 0 END) +
            (CASE WHEN command LIKE ?4 THEN 40 ELSE 0 END) +
            (execution_count * 5) +
            (CASE WHEN (?5 - timestamp) < 86400 THEN 50 ELSE 0 END)
        ) as score
        FROM shell_history WHERE "
    );

    let mut where_clauses = Vec::new();
    for _ in 0..keywords.len() {
        where_clauses.push("command LIKE ?");
    }
    sql.push_str(&where_clauses.join(" AND "));
    sql.push_str(" ORDER BY score DESC, timestamp DESC LIMIT ?");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    params.push(Box::new(trimmed_query.to_string()));
    params.push(Box::new(format!("{}%", trimmed_query)));
    params.push(Box::new(format!("% {}%", trimmed_query)));
    params.push(Box::new(format!("%{}%", trimmed_query)));
    params.push(Box::new(now));

    for kw in &keywords {
        params.push(Box::new(format!("%{}%", kw)));
    }

    params.push(Box::new(limit as i64));

    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(ShellHistoryEntry {
            id: row.get("id")?,
            command: row.get("command")?,
            timestamp: row.get("timestamp")?,
            execution_count: row.get("execution_count")?,
        })
    }).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for entry in rows {
        entries.push(entry.map_err(|e| e.to_string())?);
    }

    Ok(entries)
}
