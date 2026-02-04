use rusqlite::params;
use tauri::State;
use uuid::Uuid;

use super::init::DbState;
use super::models::{Prompt, PromptCounts, PromptCsvRow};

// ============================================================================
// Prompt CRUD Operations
// ============================================================================

#[tauri::command]
pub fn get_prompts(
    state: State<DbState>,
    page: u32,
    page_size: u32,
    group: String,
    category: Option<String>,
) -> Result<Vec<Prompt>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let offset = (page - 1) * page_size;

    let mut query = String::from("SELECT * FROM prompts WHERE 1=1");
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if group == "favorite" {
        query.push_str(" AND is_favorite = 1");
    } else if group != "all" {
        query.push_str(" AND group_name = ?");
        params.push(Box::new(group));
    }

    if let Some(cat) = category {
        if cat == "prompt" {
            query.push_str(" AND (type = 'prompt' OR type IS NULL)");
        } else {
            query.push_str(" AND type = ?");
            params.push(Box::new(cat));
        }
    }

    query.push_str(" ORDER BY created_at DESC LIMIT ? OFFSET ?");
    params.push(Box::new(page_size));
    params.push(Box::new(offset));

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let prompt_iter = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(Prompt {
            id: row.get("id")?,
            title: row.get("title")?,
            content: row.get("content")?,
            group_name: row.get("group_name")?,
            description: row.get("description")?,
            tags: row.get::<_, Option<String>>("tags")?.map(|s| serde_json::from_str(&s).unwrap_or_default()),
            is_favorite: row.get("is_favorite")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            source: row.get("source")?,
            pack_id: row.get("pack_id")?,
            original_id: row.get("original_id")?,
            type_: row.get("type")?,
            is_executable: row.get("is_executable").unwrap_or(Some(false)),
            shell_type: row.get("shell_type").unwrap_or(None),
            use_as_chat_template: row.get("use_as_chat_template").unwrap_or(Some(false)),
        })
    }).map_err(|e| e.to_string())?;

    let mut prompts = Vec::new();
    for p in prompt_iter {
        prompts.push(p.map_err(|e| e.to_string())?);
    }
    Ok(prompts)
}

#[tauri::command]
pub fn search_prompts(
    state: State<DbState>,
    query: String,
    page: u32,
    page_size: u32,
    category: Option<String>,
) -> Result<Vec<Prompt>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let offset = (page - 1) * page_size;
    let trimmed_query = query.trim();

    if trimmed_query.is_empty() {
        return Ok(Vec::new());
    }

    // 1. 分词处理：支持 "adb help" 这种组合搜索
    let keywords: Vec<&str> = trimmed_query.split_whitespace().collect();
    if keywords.is_empty() {
        return Ok(Vec::new());
    }

    // 2. 构建动态 SQL
    // 我们计算一个 score 字段，用于排序
    let mut sql = String::from(
        "SELECT *,
        (
            -- 权重 1: 标题完全匹配 (100分)
            (CASE WHEN title LIKE ?1 THEN 100 ELSE 0 END) +
            -- 权重 2: 标题以查询词开头 (80分)
            (CASE WHEN title LIKE ?2 THEN 80 ELSE 0 END) +
            -- 权重 3: 标题中包含 ' 查询词' (单词边界匹配) (60分)
            (CASE WHEN title LIKE ?3 THEN 60 ELSE 0 END) +
            -- 权重 4: 标题包含查询词 (40分)
            (CASE WHEN title LIKE ?4 THEN 40 ELSE 0 END) +
            -- 权重 5: 内容包含查询词 (20分)
            (CASE WHEN content LIKE ?4 THEN 20 ELSE 0 END) +
            -- 额外加分: 收藏的项目 (+10分)
            (is_favorite * 10)
        ) as score
        FROM prompts
        WHERE "
    );

    let mut where_clauses = Vec::new();
    for _ in 0..keywords.len() {
        where_clauses.push("(title LIKE ? OR content LIKE ? OR description LIKE ?)");
    }
    sql.push_str(&where_clauses.join(" AND "));

    // 4. 加上分类过滤
    if let Some(cat) = &category {
        if cat == "prompt" {
            sql.push_str(" AND (type = 'prompt' OR type IS NULL)");
        } else {
            sql.push_str(&format!(" AND type = '{}'", cat));
        }
    }

    // 5. 排序：先按分数高低，再按更新时间
    sql.push_str(" ORDER BY score DESC, updated_at DESC LIMIT ? OFFSET ?");

    // 6. 准备参数
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    // 评分参数 (基于完整查询词)
    params.push(Box::new(trimmed_query.to_string()));             // ?1: exact
    params.push(Box::new(format!("{}%", trimmed_query)));         // ?2: starts with
    params.push(Box::new(format!("% {}%", trimmed_query)));       // ?3: word boundary
    params.push(Box::new(format!("%{}%", trimmed_query)));        // ?4: contains

    // 过滤参数 (基于每个分词)
    for kw in keywords {
        let pattern = format!("%{}%", kw);
        params.push(Box::new(pattern.clone())); // title
        params.push(Box::new(pattern.clone())); // content
        params.push(Box::new(pattern.clone())); // description
    }

    // 分页参数
    params.push(Box::new(page_size));
    params.push(Box::new(offset));

    // 7. 执行查询
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let prompt_iter = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(Prompt {
            id: row.get("id")?,
            title: row.get("title")?,
            content: row.get("content")?,
            group_name: row.get("group_name")?,
            description: row.get("description")?,
            tags: row.get::<_, Option<String>>("tags")?.map(|s| serde_json::from_str(&s).unwrap_or_default()),
            is_favorite: row.get("is_favorite")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            source: row.get("source")?,
            pack_id: row.get("pack_id")?,
            original_id: row.get("original_id")?,
            type_: row.get("type")?,
            is_executable: row.get("is_executable").unwrap_or(Some(false)),
            shell_type: row.get("shell_type").unwrap_or(None),
            use_as_chat_template: row.get("use_as_chat_template").unwrap_or(Some(false)),
        })
    }).map_err(|e| e.to_string())?;

    let mut prompts = Vec::new();
    for p in prompt_iter {
        prompts.push(p.map_err(|e| e.to_string())?);
    }

    Ok(prompts)
}

#[tauri::command]
pub fn save_prompt(
    state: State<DbState>,
    prompt: Prompt
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tags_json = serde_json::to_string(&prompt.tags).unwrap_or("[]".to_string());

    conn.execute(
        "INSERT OR REPLACE INTO prompts (
            id, title, content, group_name, description, tags,
            is_favorite, created_at, updated_at, source, pack_id, original_id, type,
            is_executable, shell_type, use_as_chat_template
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            prompt.id,
            prompt.title,
            prompt.content,
            prompt.group_name,
            prompt.description,
            tags_json,
            prompt.is_favorite,
            prompt.created_at,
            prompt.updated_at,
            prompt.source,
            prompt.pack_id,
            prompt.original_id,
            prompt.type_,
            prompt.is_executable,
            prompt.shell_type,
            prompt.use_as_chat_template
        ],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_prompt(
    state: State<DbState>,
    id: String
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM prompts WHERE id = ?", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn toggle_prompt_favorite(
    state: State<DbState>,
    id: String
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE prompts SET is_favorite = NOT is_favorite WHERE id = ?",
        params![id]
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn import_prompt_pack(
    state: State<DbState>,
    pack_id: String,
    prompts: Vec<Prompt>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM prompts WHERE pack_id = ?", params![pack_id])
        .map_err(|e| e.to_string())?;

    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO prompts (
                id, title, content, group_name, description, tags,
                is_favorite, created_at, updated_at, source, pack_id, original_id, type,
                is_executable, shell_type, use_as_chat_template
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).map_err(|e| e.to_string())?;

        for p in prompts {
            let tags_json = serde_json::to_string(&p.tags).unwrap_or("[]".to_string());
            stmt.execute(params![
                p.id, p.title, p.content, p.group_name, p.description, tags_json,
                p.is_favorite, p.created_at, p.updated_at, p.source, pack_id.clone(), p.original_id, p.type_,
                p.is_executable, p.shell_type, p.use_as_chat_template
            ]).map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn batch_import_local_prompts(
    state: State<DbState>,
    prompts: Vec<Prompt>,
) -> Result<usize, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut count = 0;

    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO prompts (
                id, title, content, group_name, description, tags,
                is_favorite, created_at, updated_at, source, pack_id, original_id, type,
                is_executable, shell_type, use_as_chat_template
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).map_err(|e| e.to_string())?;

        for p in prompts {
            let tags_json = serde_json::to_string(&p.tags).unwrap_or("[]".to_string());
            stmt.execute(params![
                p.id, p.title, p.content, p.group_name, p.description, tags_json,
                p.is_favorite, p.created_at, p.updated_at, p.source, p.pack_id, p.original_id, p.type_,
                p.is_executable, p.shell_type, p.use_as_chat_template
            ]).map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn get_prompt_groups(state: State<DbState>) -> Result<Vec<String>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT DISTINCT group_name FROM prompts ORDER BY group_name").map_err(|e| e.to_string())?;
    let groups = stmt.query_map([], |row| row.get(0)).map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>().map_err(|e| e.to_string())?;
    Ok(groups)
}

#[tauri::command]
pub fn get_prompt_counts(state: State<DbState>) -> Result<PromptCounts, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // SQLite uses idx_prompts_type index for efficient scan
    let (command_count, prompt_count): (i64, i64) = conn.query_row(
        "SELECT
            COUNT(CASE WHEN type = 'command' THEN 1 END),
            COUNT(CASE WHEN type = 'prompt' OR type IS NULL THEN 1 END)
         FROM prompts",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap_or((0, 0));

    Ok(PromptCounts {
        prompt: prompt_count,
        command: command_count,
    })
}

#[tauri::command]
pub fn get_chat_templates(state: State<DbState>) -> Result<Vec<Prompt>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT * FROM prompts
         WHERE use_as_chat_template = 1
         ORDER BY title ASC"
    ).map_err(|e| e.to_string())?;

    let prompt_iter = stmt.query_map([], |row| {
        Ok(Prompt {
            id: row.get("id")?,
            title: row.get("title")?,
            content: row.get("content")?,
            group_name: row.get("group_name")?,
            description: row.get("description")?,
            tags: row.get::<_, Option<String>>("tags")?.map(|s| serde_json::from_str(&s).unwrap_or_default()),
            is_favorite: row.get("is_favorite")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            source: row.get("source")?,
            pack_id: row.get("pack_id")?,
            original_id: row.get("original_id")?,
            type_: row.get("type")?,
            is_executable: row.get("is_executable").unwrap_or(Some(false)),
            shell_type: row.get("shell_type").unwrap_or(None),
            use_as_chat_template: row.get("use_as_chat_template").unwrap_or(Some(false)),
        })
    }).map_err(|e| e.to_string())?;

    let mut prompts = Vec::new();
    for p in prompt_iter {
        prompts.push(p.map_err(|e| e.to_string())?);
    }
    Ok(prompts)
}

// ============================================================================
// CSV Import/Export
// ============================================================================

use std::fs::File;
use std::io::Write;

#[tauri::command]
#[allow(dead_code)]
pub fn export_prompts_to_csv(
    state: State<DbState>,
    save_path: String,
) -> Result<usize, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // 1. Create file and write BOM (for Excel compatibility)
    let mut file = File::create(&save_path).map_err(|e| e.to_string())?;
    file.write_all(b"\xEF\xBB\xBF").map_err(|e| e.to_string())?; // UTF-8 BOM

    // 2. Initialize CSV Writer with auto-flush
    let mut wtr = csv::WriterBuilder::new()
        .has_headers(true)
        .from_writer(file);

    // 3. Stream data from database (row by row, no intermediate Vec)
    let mut stmt = conn
        .prepare("SELECT * FROM prompts ORDER BY group_name, title")
        .map_err(|e| e.to_string())?;

    let mut count = 0;
    let rows = stmt.query_map([], |row| {
        let tags_json: Option<String> = row.get("tags")?;
        let tags_vec: Vec<String> = tags_json
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

        Ok(PromptCsvRow {
            id: Some(row.get("id")?),
            title: row.get("title")?,
            content: row.get("content")?,
            group_name: row.get("group_name")?,
            description: row.get("description")?,
            tags: tags_vec.join(", "),
            is_favorite: row.get("is_favorite")?,
            type_: row.get::<_, Option<String>>("type")?.unwrap_or("prompt".to_string()),
            is_executable: row.get("is_executable").unwrap_or(false),
            shell_type: row.get("shell_type").unwrap_or(None),
        })
    }).map_err(|e| e.to_string())?;

    for result in rows {
        let row = result.map_err(|e| e.to_string())?;
        wtr.serialize(row).map_err(|e| e.to_string())?;
        // Auto-flush every 100 rows to balance performance and memory
        if count % 100 == 0 {
            wtr.flush().map_err(|e| e.to_string())?;
        }
        count += 1;
    }

    wtr.flush().map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
#[allow(dead_code)]
pub fn import_prompts_from_csv(
    state: State<DbState>,
    file_path: String,
    mode: String,
) -> Result<usize, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;

    // 1. Read CSV
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .trim(csv::Trim::All)
        .from_path(file_path)
        .map_err(|e| format!("无法读取 CSV 文件: {}", e))?;

    let now = chrono::Utc::now().timestamp_millis();

    // 2. Execute write in transaction
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    if mode == "overwrite" {
        tx.execute("DELETE FROM prompts", []).map_err(|e| e.to_string())?;
    }

    // overwrite: INSERT OR REPLACE (存在则更新)
    // merge: INSERT OR IGNORE (存在则跳过)
    let sql = if mode == "overwrite" {
        "INSERT OR REPLACE INTO prompts (
            id, title, content, group_name, description, tags,
            is_favorite, created_at, updated_at, source, type,
            is_executable, shell_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    } else {
        "INSERT OR IGNORE INTO prompts (
            id, title, content, group_name, description, tags,
            is_favorite, created_at, updated_at, source, type,
            is_executable, shell_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    };

    let mut affected = 0;

    {
        let mut stmt = tx.prepare(sql).map_err(|e| e.to_string())?;

        for result in rdr.deserialize() {
            let record: PromptCsvRow =
                result.map_err(|e| format!("CSV 格式错误: {}", e))?;

            // Process ID: empty -> generate new UUID
            let id = if let Some(ref pid) = record.id {
                if pid.trim().is_empty() {
                    Uuid::new_v4().to_string()
                } else {
                    pid.clone()
                }
            } else {
                Uuid::new_v4().to_string()
            };

            // Process Tags: "tag1, tag2" -> ["tag1", "tag2"]
            let tags_vec: Vec<String> = record
                .tags
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            let tags_json = serde_json::to_string(&tags_vec).unwrap_or("[]".to_string());

            let group_name = if record.group_name.is_empty() {
                "Default".to_string()
            } else {
                record.group_name
            };

            let result = stmt.execute(params![
                id,
                record.title,
                record.content,
                group_name,
                record.description,
                tags_json,
                record.is_favorite,
                now,
                now,
                "local".to_string(),
                record.type_,
                record.is_executable,
                record.shell_type,
            ]);

            // INSERT OR IGNORE 返回变化行数为 0 时表示已存在
            if result.is_ok() {
                affected += 1;
            }
        }
    } // stmt 在这里被释放

    tx.commit().map_err(|e| e.to_string())?;

    Ok(affected)
}
