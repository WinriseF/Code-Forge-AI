use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

// 引入 Refinery 迁移宏
use refinery::embed_migrations;

// 编译时嵌入 migrations 文件夹中的 SQL 文件
embed_migrations!("./migrations");

pub struct DbState {
    pub conn: Mutex<Connection>,
}

// 辅助函数：检查列是否存在
fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    let query = format!("PRAGMA table_info({})", table);
    let mut stmt = match conn.prepare(&query) {
        Ok(s) => s,
        Err(_) => return false,
    };

    let exists = stmt.query_map([], |row| {
        let name: String = row.get(1)?;
        Ok(name)
    }).map(|iter| {
        iter.flatten().any(|name| name == column)
    }).unwrap_or(false);

    exists
}

// 核心：处理遗留数据库（Patch Legacy）
// 在 Refinery 运行前，先把老用户的数据库补齐成 V1 的样子
fn patch_legacy_database(conn: &Connection) -> rusqlite::Result<()> {
    // 检查是否是老用户：有 prompts 表，但没有 refinery 表
    let has_prompts = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='prompts'",
        [],
        |r| r.get::<_, i32>(0)
    ).unwrap_or(0) > 0;

    let has_refinery = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='refinery_schema_history'",
        [],
        |r| r.get::<_, i32>(0)
    ).unwrap_or(0) > 0;

    // 如果不是老用户环境（要么是全新的，要么已经是 Refinery 管理的），直接返回
    if !has_prompts || has_refinery {
        return Ok(());
    }

    println!("[Database] Legacy database detected. Applying patches to match V1 baseline...");

    // 逐个检查 V1 中包含但老用户可能没有的字段
    if !column_exists(conn, "prompts", "is_executable") {
        println!("[Database] Patching: adding is_executable");
        conn.execute("ALTER TABLE prompts ADD COLUMN is_executable INTEGER DEFAULT 0", [])?;
    }

    if !column_exists(conn, "prompts", "shell_type") {
        println!("[Database] Patching: adding shell_type");
        conn.execute("ALTER TABLE prompts ADD COLUMN shell_type TEXT", [])?;
    }

    if !column_exists(conn, "prompts", "use_as_chat_template") {
        println!("[Database] Patching: adding use_as_chat_template");
        conn.execute("ALTER TABLE prompts ADD COLUMN use_as_chat_template INTEGER DEFAULT 0", [])?;
    }

    // 确保其他表也存在
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS url_history (
            url TEXT PRIMARY KEY,
            title TEXT,
            visit_count INTEGER DEFAULT 1,
            last_visit INTEGER
        );
        CREATE TABLE IF NOT EXISTS project_configs (
            path TEXT PRIMARY KEY,
            config TEXT NOT NULL,
            updated_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS ignored_secrets (
            id TEXT PRIMARY KEY,
            value TEXT NOT NULL UNIQUE,
            rule_id TEXT,
            created_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS apps (
            path TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            keywords TEXT,
            icon TEXT,
            usage_count INTEGER DEFAULT 0,
            last_used_at INTEGER DEFAULT 0
        );
    ")?;

    println!("[Database] Legacy database patched successfully.");
    Ok(())
}

pub fn init_db(app_handle: &AppHandle) -> Result<Connection, Box<dyn std::error::Error>> {
    let app_dir = app_handle.path().app_local_data_dir().unwrap();
    if !app_dir.exists() {
        std::fs::create_dir_all(&app_dir).unwrap();
    }
    let db_path = app_dir.join("prompts.db");

    let mut conn = Connection::open(db_path)?;

    // 基础优化
    conn.execute_batch("
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
    ")?;

    // --- 关键步骤：先手动补齐老数据 ---
    if let Err(e) = patch_legacy_database(&conn) {
        eprintln!("[Database] Failed to patch legacy database: {}", e);
    }

    match migrations::runner().run(&mut conn) {
        Ok(report) => {
            let applied = report.applied_migrations();
            if !applied.is_empty() {
                println!("[Database] Applied {} migrations.", applied.len());
                for m in applied {
                    println!("[Database] - {}", m.name());
                }
            }
        },
        Err(e) => return Err(Box::new(e)),
    }

    Ok(conn)
}
