use rusqlite::{params, Connection};
use tauri::{AppHandle, Manager, State};
use regex::Regex;

use super::init::DbState;
use super::models::UrlHistoryItem;

// ============================================================================
// URL History Commands
// ============================================================================

#[tauri::command]
pub async fn record_url_visit(
    app_handle: AppHandle,
    state: State<'_, DbState>,
    url: String
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp();

    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO url_history (url, visit_count, last_visit, title)
             VALUES (?1, 1, ?2, '')
             ON CONFLICT(url) DO UPDATE SET
                visit_count = visit_count + 1,
                last_visit = ?2",
            params![url, now],
        ).map_err(|e| e.to_string())?;
    }

    let url_clone = url.clone();
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .timeout(std::time::Duration::from_secs(3))
            .build();

        if let Ok(c) = client {
            if let Ok(resp) = c.get(&url_clone)
                .header("Range", "bytes=0-16384") // Only request the first 16KB
                .send()
                .await
            {
                // A successful range request returns 206 Partial Content
                if resp.status().is_success() || resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                    if let Ok(text) = resp.text().await {
                        if let Ok(re) = Regex::new(r"(?is)<title>(.*?)</title>") {
                            if let Some(caps) = re.captures(&text) {
                                if let Some(title_match) = caps.get(1) {
                                    let raw_title = title_match.as_str().trim();
                                    let clean_title = raw_title.replace('\n', " ").replace('\r', "").trim().to_string();

                                    if !clean_title.is_empty() {
                                        if let Ok(app_dir) = app_handle.path().app_local_data_dir() {
                                            let db_path = app_dir.join("prompts.db");
                                            if let Ok(conn) = Connection::open(db_path) {
                                                let _ = conn.execute(
                                                    "UPDATE url_history SET title = ?1 WHERE url = ?2 AND (title IS NULL OR title = '')",
                                                    params![clean_title, url_clone],
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn search_url_history(
    state: State<DbState>,
    query: String
) -> Result<Vec<UrlHistoryItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let clean_query = query.replace("\"", "");
    let char_count = clean_query.chars().count();

    if clean_query.trim().is_empty() {
        let mut stmt = conn.prepare(
            "SELECT url, title, visit_count, last_visit FROM url_history
             ORDER BY last_visit DESC LIMIT 10"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |row| {
            Ok(UrlHistoryItem {
                url: row.get("url")?,
                title: row.get("title")?,
                visit_count: row.get("visit_count")?,
                last_visit: row.get("last_visit")?,
            })
        }).map_err(|e| e.to_string())?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r.map_err(|e| e.to_string())?);
        }
        return Ok(results);
    }

    let mut sql = String::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if char_count < 3 {
        let like_query = format!("%{}%", clean_query);
        params.push(Box::new(like_query));

        sql.push_str(
            "SELECT url, title, visit_count, last_visit
             FROM url_history
             WHERE (url LIKE ?1 OR title LIKE ?1)
             ORDER BY visit_count DESC, last_visit DESC
             LIMIT 5"
        );
    } else {
        let fts_query = format!("\"{}\"", clean_query);
        params.push(Box::new(fts_query));

        sql.push_str(
            "SELECT h.url, h.title, h.visit_count, h.last_visit
             FROM url_history h
             JOIN url_history_fts f ON h.url = f.url
             WHERE url_history_fts MATCH ?1
             ORDER BY h.visit_count DESC, h.last_visit DESC
             LIMIT 5"
        );
    }

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(UrlHistoryItem {
            url: row.get("url")?,
            title: row.get("title")?,
            visit_count: row.get("visit_count")?,
            last_visit: row.get("last_visit")?,
        })
    }).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for r in rows {
        results.push(r.map_err(|e| e.to_string())?);
    }

    Ok(results)
}
