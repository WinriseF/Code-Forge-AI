use tauri::{State, Emitter, Manager}; // 引入 Emitter, Manager 用于通知前端和获取状态
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json;
use clipboard_rs::Clipboard; // 导入 Clipboard trait
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::db::DbState;
use super::model::RefineryItem;
use super::storage::{create_manual_note_db, update_note_db};
use super::cleanup_worker::RefineryCleanupConfig;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefineryStatistics {
    pub total_entries: u32,
    pub this_week: u32,
    pub favorites: u32,
}

// ============================================================================
// 查询与筛选 (Read) - 升级版
// ============================================================================

#[tauri::command]
pub fn get_refinery_history(
    state: State<DbState>,
    page: u32,
    page_size: u32,
    search_query: Option<String>,
    kind_filter: Option<String>, // "text" | "image"
    pinned_only: bool,
    manual_only: bool,
    start_date: Option<i64>,
    end_date: Option<i64>,
) -> Result<Vec<RefineryItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let offset = (page - 1) * page_size;

    // 列表查询优化：
    // - 图片类型：返回 content（文件路径，很短）
    // - 文本类型：不返回 content（可能很长，只在详情时加载）
    let mut sql = String::from(
        "SELECT id, kind,
                CASE WHEN kind = 'image' THEN content ELSE NULL END as content,
                content_hash, preview, source_app, url, size_info,
                is_pinned, metadata, created_at, updated_at,
                title, tags, is_manual, is_edited
         FROM refinery_history WHERE 1=1"
    );
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    // 1. 关键词搜索 - 统一使用 FTS5 全文搜索
    // FTS 索引包含 content, title, source_app, preview
    // 文本记录搜索全部字段，图片记录搜索 title 和 source_app
    if let Some(q) = search_query {
        let q_str = q.trim();
        if !q_str.is_empty() {
            // FTS5 MATCH 语法：转义特殊字符
            let escaped_query = q_str
                .replace('\\', "\\\\")
                .replace('"', "\"\"")
                .replace(' ', " AND ");

            // 使用纯 FTS 查询，性能更优
            sql.push_str(&format!(
                " AND rowid IN (SELECT rowid FROM refinery_fts WHERE refinery_fts MATCH \"{}\")",
                escaped_query
            ));
        }
    }

    // 2. 类型筛选
    if let Some(k) = kind_filter {
        if k == "text" || k == "image" {
            sql.push_str(" AND kind = ?");
            params.push(Box::new(k));
        }
    }

    // 3. 收藏筛选
    if pinned_only {
        sql.push_str(" AND is_pinned = 1");
    }

    // 3.5. 笔记筛选 (只显示手动创建的笔记)
    if manual_only {
        sql.push_str(" AND is_manual = 1");
    }

    // 4. 日期范围筛选
    if let Some(start) = start_date {
        sql.push_str(" AND created_at >= ?");
        params.push(Box::new(start));
    }
    if let Some(end) = end_date {
        sql.push_str(" AND created_at <= ?");
        params.push(Box::new(end));
    }

    // 5. 排序与分页
    sql.push_str(" ORDER BY updated_at DESC LIMIT ? OFFSET ?");
    params.push(Box::new(page_size));
    params.push(Box::new(offset));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    // 转换参数类型以匹配 rusqlite api
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let iter = stmt.query_map(param_refs.as_slice(), |row| {
        // 处理 tags JSON 字符串转 Vec<String>
        let tags_str: Option<String> = row.get("tags")?;
        let tags: Option<Vec<String>> = tags_str.and_then(|s| serde_json::from_str(&s).ok());

        // content：图片返回路径，文本返回 NULL
        let kind: String = row.get("kind")?;
        let content: Option<String> = if kind == "image" {
            row.get("content")?
        } else {
            None
        };

        Ok(RefineryItem {
            id: row.get("id")?,
            kind,
            content,
            content_hash: row.get("content_hash")?,
            preview: row.get("preview")?,
            source_app: row.get("source_app")?,
            url: row.get("url")?,
            size_info: row.get("size_info")?,
            is_pinned: row.get("is_pinned")?,
            metadata: row.get("metadata")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            // [新增字段映射]
            title: row.get("title")?,
            tags,
            is_manual: row.get("is_manual").unwrap_or(false),
            is_edited: row.get("is_edited").unwrap_or(false),
        })
    }).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for item in iter {
        results.push(item.map_err(|e| e.to_string())?);
    }

    Ok(results)
}

/// 获取单个条目的完整内容（用于打开抽屉时加载）
#[tauri::command]
pub fn get_refinery_item_detail(state: State<DbState>, id: String) -> Result<Option<RefineryItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let item = conn.query_row(
        "SELECT * FROM refinery_history WHERE id = ?",
        params![id],
        |row| {
            // 处理 tags JSON 字符串转 Vec<String>
            let tags_str: Option<String> = row.get("tags")?;
            let tags: Option<Vec<String>> = tags_str.and_then(|s| serde_json::from_str(&s).ok());

            Ok(RefineryItem {
                id: row.get("id")?,
                kind: row.get("kind")?,
                content: row.get("content")?,
                content_hash: row.get("content_hash")?,
                preview: row.get("preview")?,
                source_app: row.get("source_app")?,
                url: row.get("url")?,
                size_info: row.get("size_info")?,
                is_pinned: row.get("is_pinned")?,
                metadata: row.get("metadata")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
                title: row.get("title")?,
                tags,
                is_manual: row.get("is_manual").unwrap_or(false),
                is_edited: row.get("is_edited").unwrap_or(false),
            })
        }
    ).optional().map_err(|e| e.to_string())?;

    Ok(item)
}

/// 获取统计信息
#[tauri::command]
pub fn get_refinery_statistics(state: State<DbState>) -> Result<RefineryStatistics, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // 总条目数
    let total_entries: u32 = conn.query_row(
        "SELECT COUNT(*) FROM refinery_history",
        [],
        |row| row.get(0)
    ).map_err(|e| e.to_string())?;

    // 收藏数
    let favorites: u32 = conn.query_row(
        "SELECT COUNT(*) FROM refinery_history WHERE is_pinned = 1",
        [],
        |row| row.get(0)
    ).map_err(|e| e.to_string())?;

    // 本周新增（计算7天前的时间戳）
    let week_ago = chrono::Utc::now().timestamp_millis() - (7 * 24 * 60 * 60 * 1000);
    let this_week: u32 = conn.query_row(
        "SELECT COUNT(*) FROM refinery_history WHERE created_at > ?",
        params![week_ago],
        |row| row.get(0)
    ).map_err(|e| e.to_string())?;

    Ok(RefineryStatistics {
        total_entries,
        this_week,
        favorites,
    })
}

// ============================================================================
// 操作与状态修改 (Update)
// ============================================================================

#[tauri::command]
pub fn toggle_refinery_pin(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE refinery_history SET is_pinned = NOT is_pinned WHERE id = ?",
        params![id]
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// 删除逻辑 (Delete) - 包含文件清理
// ============================================================================

/// 内部辅助函数：根据 ID 列表删除数据库记录并清理关联文件
fn delete_items_internal(conn: &rusqlite::Connection, ids: &[String]) -> Result<usize, String> {
    if ids.is_empty() {
        return Ok(0);
    }

    // 1. 查找需要删除的记录中，哪些是图片（需要删文件）
    let mut files_to_delete: Vec<String> = Vec::new();

    {
        let mut stmt = conn.prepare("SELECT kind, content FROM refinery_history WHERE id = ?")
            .map_err(|e| e.to_string())?;

        for id in ids {
            let rows = stmt.query_map(params![id], |row| {
                let kind: String = row.get(0)?;
                let content: String = row.get(1)?;
                Ok((kind, content))
            }).map_err(|e| e.to_string())?;

            for r in rows {
                if let Ok((kind, content)) = r {
                    if kind == "image" {
                        files_to_delete.push(content);
                    }
                }
            }
        }
    }

    // 2. 执行数据库删除 (开启事务)
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut deleted_count = 0;

    {
        let mut delete_stmt = tx.prepare("DELETE FROM refinery_history WHERE id = ?")
            .map_err(|e| e.to_string())?;

        for id in ids {
            deleted_count += delete_stmt.execute(params![id]).map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    // 3. 执行文件系统删除 (数据库提交成功后再删文件)
    for path_str in files_to_delete {
        let path = std::path::Path::new(&path_str);
        if path.exists() {
            let _ = std::fs::remove_file(path).map_err(|e|
                println!("[Refinery] Failed to delete image file: {} - {}", path_str, e)
            );
        }
    }

    Ok(deleted_count)
}

#[tauri::command]
pub fn delete_refinery_items(
    state: State<DbState>,
    ids: Vec<String>
) -> Result<usize, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    delete_items_internal(&conn, &ids)
}

#[tauri::command]
pub fn clear_refinery_history(
    state: State<DbState>,
    before_timestamp: Option<i64>, // 如果为 None，则清空所有
    include_pinned: bool,          // 是否同时也删除收藏的项目
) -> Result<usize, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // 1. 构建查询条件，找出所有待删除的 ID
    let mut sql = String::from("SELECT id FROM refinery_history WHERE 1=1");
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    // 时间筛选 (清除 X 天前的记录)
    if let Some(ts) = before_timestamp {
        sql.push_str(" AND created_at < ?");
        params.push(Box::new(ts));
    }

    // 保护收藏项
    if !include_pinned {
        sql.push_str(" AND is_pinned = 0");
    }

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let ids: Vec<String> = stmt.query_map(param_refs.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    if ids.is_empty() {
        return Ok(0);
    }

    // 2. 复用删除逻辑
    delete_items_internal(&conn, &ids)
}

// ============================================================================
// 剪贴板操作 (Clipboard)
// ============================================================================

/// 复制文本到剪贴板
#[tauri::command]
pub async fn copy_refinery_text(text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let clipboard = clipboard_rs::ClipboardContext::new()
            .map_err(|e| format!("Failed to init clipboard: {}", e))?;

        clipboard.set_text(text)
            .map_err(|e| format!("Failed to copy text: {}", e))?;

        Ok(())
    }).await.map_err(|e| e.to_string())?
}

/// 复制图片到剪贴板
#[tauri::command]
pub async fn copy_refinery_image(image_path: String) -> Result<(), String> {
    use clipboard_rs::common::{RustImageData, RustImage};
    use std::path::Path;

    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&image_path);
        if !path.exists() {
            return Err(format!("Image file not found: {}", image_path));
        }

        // 使用 image crate 打开图片
        let img = image::open(path)
            .map_err(|e| format!("Failed to open image: {}", e))?;

        // 优化：原图直接复制，仅对超大图（>4K）进行快速降采样
        // Triangle 算法比 Lanczos3 快 10 倍以上，对绝大多数场景足够清晰
        let final_img = if img.width() > 4096 || img.height() > 4096 {
            // 计算缩放后的尺寸，保持宽高比
            let (max_w, max_h) = if img.width() > img.height() {
                (4096, (4096 * img.height() / img.width()).max(1))
            } else {
                ((4096 * img.width() / img.height()).max(1), 4096)
            };
            img.resize(max_w, max_h, image::imageops::FilterType::Triangle)
        } else {
            img
        };

        // 转换为剪贴板格式
        let rust_image = RustImageData::from_dynamic_image(final_img);

        // 创建剪贴板上下文
        let clipboard = clipboard_rs::ClipboardContext::new()
            .map_err(|e| format!("Failed to init clipboard: {}", e))?;

        clipboard.set_image(rust_image)
            .map_err(|e| format!("Failed to copy image: {}", e))?;

        Ok(())
    }).await.map_err(|e| e.to_string())?
}

// ============================================================================
// 笔记操作 (Create/Update) - 新增
// ============================================================================

#[tauri::command]
pub fn create_note(
    app: tauri::AppHandle,
    state: State<DbState>,
    content: String,
    title: Option<String>
) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // 调用 storage 层逻辑
    let new_id = create_manual_note_db(&conn, content, title)?;

    // 通知前端刷新列表
    let _ = app.emit("refinery://new-entry", &new_id);

    Ok(new_id)
}

#[tauri::command]
pub fn update_note(
    app: tauri::AppHandle,
    state: State<DbState>,
    id: String,
    content: Option<String>,
    title: Option<String>
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // 调用 storage 层逻辑
    update_note_db(&conn, &id, content, title)?;

    // 通知前端刷新 (update 事件)
    let _ = app.emit("refinery://update", &id);

    Ok(())
}

// ============================================================================
// 自动清理功能 (V5 新增)
// ============================================================================

/// 清理配置状态（用于 Tauri State）
pub struct CleanupConfigState(pub Arc<Mutex<RefineryCleanupConfig>>);

/// 更新清理配置
#[tauri::command]
pub async fn update_cleanup_config(
    state: State<'_, CleanupConfigState>,
    config: RefineryCleanupConfig,
) -> Result<(), String> {
    let mut state_config = state.0.lock().await;
    *state_config = config;
    println!("[Refinery Cleanup] Config updated: enabled={}, strategy={}", state_config.enabled, state_config.strategy);
    Ok(())
}

/// 手动触发清理
#[tauri::command]
pub async fn manual_cleanup(
    app: tauri::AppHandle,
    config_state: State<'_, CleanupConfigState>,
) -> Result<usize, String> {
    let config = config_state.0.lock().await.clone();

    if !config.enabled {
        return Ok(0);
    }

    match config.strategy.as_str() {
        "count" => {
            if let Some(max_count) = config.max_count {
                execute_count_cleanup(&app, max_count, config.keep_pinned)
            } else {
                Ok(0)
            }
        }
        "time" => {
            if let Some(days) = config.days {
                execute_time_cleanup(&app, days, config.keep_pinned)
            } else {
                Ok(0)
            }
        }
        "both" => {
            // 先尝试数量清理，如果没有删除则尝试时间清理
            let count_deleted = if let Some(max_count) = config.max_count {
                execute_count_cleanup(&app, max_count, config.keep_pinned).unwrap_or(0)
            } else {
                0
            };

            if count_deleted == 0 {
                if let Some(days) = config.days {
                    execute_time_cleanup(&app, days, config.keep_pinned)
                } else {
                    Ok(0)
                }
            } else {
                Ok(count_deleted)
            }
        }
        _ => Ok(0),
    }
}

// ============================================================================
// 清理逻辑实现
// ============================================================================

/// 缓冲比例：5%
const CLEANUP_BUFFER_RATIO: f64 = 0.05;

/// 执行数量清理（带缓冲）
pub fn execute_count_cleanup(
    app: &tauri::AppHandle,
    max_count: u32,
    keep_pinned: bool,
) -> Result<usize, String> {
    use crate::db::DbState;

    let state = app.state::<DbState>();
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // 计算缓冲阈值
    let buffer = (max_count as f64 * CLEANUP_BUFFER_RATIO).ceil() as u32;
    let threshold = max_count + buffer;

    // 查询当前总数（不包括笔记 is_manual=0）
    let total: u32 = conn.query_row(
        "SELECT COUNT(*) FROM refinery_history WHERE is_manual = 0",
        [],
        |row| row.get(0)
    ).map_err(|e| e.to_string())?;

    if total <= threshold {
        return Ok(0);
    }

    // 需要删除的数量
    let to_delete = total - max_count;

    // 构建查询：查找最旧的符合条件的记录
    let mut sql = String::from("
        SELECT id FROM refinery_history
        WHERE is_manual = 0
    ");

    if keep_pinned {
        sql.push_str(" AND is_pinned = 0");
    }

    sql.push_str(&format!(" ORDER BY updated_at ASC LIMIT {}", to_delete));

    // 查询待删除的 ID
    let ids: Vec<String> = conn.prepare(&sql).map_err(|e| e.to_string())?
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    if ids.is_empty() {
        return Ok(0);
    }

    // 执行删除
    let deleted_count = delete_items_internal(&conn, &ids)?;

    println!(
        "[Refinery Cleanup] Deleted {} items (total: {}, threshold: {})",
        deleted_count, total, threshold
    );

    Ok(deleted_count)
}

/// 执行时间清理
pub fn execute_time_cleanup(
    app: &tauri::AppHandle,
    days: u32,
    keep_pinned: bool,
) -> Result<usize, String> {
    use crate::db::DbState;

    let state = app.state::<DbState>();
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let cutoff_time = chrono::Utc::now().timestamp_millis() - (days as i64 * 24 * 60 * 60 * 1000);

    let mut sql = String::from("
        SELECT id FROM refinery_history
        WHERE is_manual = 0 AND created_at < ?
    ");

    if keep_pinned {
        sql.push_str(" AND is_pinned = 0");
    }

    let ids: Vec<String> = conn.prepare(&sql).map_err(|e| e.to_string())?
        .query_map(params![cutoff_time], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    if ids.is_empty() {
        return Ok(0);
    }

    let deleted_count = delete_items_internal(&conn, &ids)?;

    println!(
        "[Refinery Cleanup] Time cleanup deleted {} items (older than {} days)",
        deleted_count, days
    );

    Ok(deleted_count)
}
