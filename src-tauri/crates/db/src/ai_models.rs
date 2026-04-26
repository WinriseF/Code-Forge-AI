use rusqlite::{Connection, OptionalExtension, Row, Transaction, params};
use serde_json::Value;
use tauri::State;
use uuid::Uuid;

use super::{
    error::{DbError, Result},
    init::DbState,
    models::{AiModelRecord, CreateAiModelInput, UpdateAiModelInput},
};

const AI_MODEL_SELECT_SQL: &str = "
    SELECT
        id,
        category,
        base_url,
        model_id,
        api_key,
        temperature,
        max_tokens,
        capabilities_json,
        params_json,
        enabled,
        is_default,
        created_at,
        updated_at
    FROM ai_models
";
const ALLOWED_CATEGORIES: &[&str] = &[
    "chat",
    "translation",
    "coding",
    "vision",
    "embedding",
    "rerank",
    "other",
];

#[derive(Debug, Clone)]
struct SanitizedAiModelInput {
    category: String,
    base_url: String,
    model_id: String,
    api_key: String,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
    capabilities_json: String,
    params_json: String,
    enabled: bool,
    is_default: bool,
}

fn map_ai_model_row(row: &Row<'_>) -> rusqlite::Result<AiModelRecord> {
    Ok(AiModelRecord {
        id: row.get("id")?,
        category: row.get("category")?,
        base_url: row.get("base_url")?,
        model_id: row.get("model_id")?,
        api_key: row.get("api_key")?,
        temperature: row.get("temperature")?,
        max_tokens: row.get("max_tokens")?,
        capabilities_json: row.get("capabilities_json")?,
        params_json: row.get("params_json")?,
        enabled: row.get("enabled")?,
        is_default: row.get("is_default")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn normalize_non_empty(field_name: &str, value: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(DbError::from(format!("{field_name} cannot be empty")));
    }

    Ok(trimmed.to_string())
}

fn normalize_category(value: &str) -> Result<String> {
    let normalized = normalize_non_empty("AI model category", value)?.to_ascii_lowercase();
    if !ALLOWED_CATEGORIES.contains(&normalized.as_str()) {
        return Err(DbError::from(format!(
            "Unsupported AI model category: {normalized}"
        )));
    }

    Ok(normalized)
}

fn normalize_base_url(value: &str) -> Result<String> {
    let trimmed = normalize_non_empty("AI model base URL", value)?;
    let normalized = trimmed.trim_end_matches('/').to_string();
    if normalized.is_empty() {
        return Err(DbError::from("AI model base URL cannot be empty"));
    }

    Ok(normalized)
}

fn normalize_json_object(field_name: &str, raw: Option<String>) -> Result<String> {
    let value = raw.unwrap_or_default();
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok("{}".to_string());
    }

    let parsed: Value = serde_json::from_str(trimmed)
        .map_err(|err| DbError::from(format!("{field_name} is not valid JSON: {err}")))?;

    if !parsed.is_object() {
        return Err(DbError::from(format!("{field_name} must be a JSON object")));
    }

    Ok(serde_json::to_string(&parsed)?)
}

fn normalize_temperature(value: Option<f64>) -> Result<Option<f64>> {
    match value {
        Some(v) if !v.is_finite() => Err(DbError::from("AI model temperature must be finite")),
        Some(v) => Ok(Some(v)),
        None => Ok(None),
    }
}

fn normalize_max_tokens(value: Option<i64>) -> Result<Option<i64>> {
    match value {
        Some(v) if v <= 0 => Err(DbError::from("AI model maxTokens must be greater than 0")),
        Some(v) => Ok(Some(v)),
        None => Ok(None),
    }
}

fn sanitize_create_input(input: CreateAiModelInput) -> Result<SanitizedAiModelInput> {
    let enabled = input.enabled.unwrap_or(true);
    let is_default = input.is_default.unwrap_or(false);
    if !enabled && is_default {
        return Err(DbError::from(
            "Disabled AI models cannot be marked as default",
        ));
    }

    Ok(SanitizedAiModelInput {
        category: normalize_category(&input.category)?,
        base_url: normalize_base_url(&input.base_url)?,
        model_id: normalize_non_empty("AI model ID", &input.model_id)?,
        api_key: normalize_non_empty("AI model API key", &input.api_key)?,
        temperature: normalize_temperature(input.temperature)?,
        max_tokens: normalize_max_tokens(input.max_tokens)?,
        capabilities_json: normalize_json_object(
            "AI model capabilitiesJson",
            input.capabilities_json,
        )?,
        params_json: normalize_json_object("AI model paramsJson", input.params_json)?,
        enabled,
        is_default,
    })
}

fn sanitize_update_input(input: UpdateAiModelInput) -> Result<(String, SanitizedAiModelInput)> {
    let id = normalize_non_empty("AI model id", &input.id)?;
    if !input.enabled && input.is_default {
        return Err(DbError::from(
            "Disabled AI models cannot be marked as default",
        ));
    }

    Ok((
        id,
        SanitizedAiModelInput {
            category: normalize_category(&input.category)?,
            base_url: normalize_base_url(&input.base_url)?,
            model_id: normalize_non_empty("AI model ID", &input.model_id)?,
            api_key: normalize_non_empty("AI model API key", &input.api_key)?,
            temperature: normalize_temperature(input.temperature)?,
            max_tokens: normalize_max_tokens(input.max_tokens)?,
            capabilities_json: normalize_json_object(
                "AI model capabilitiesJson",
                input.capabilities_json,
            )?,
            params_json: normalize_json_object("AI model paramsJson", input.params_json)?,
            enabled: input.enabled,
            is_default: input.is_default,
        },
    ))
}

fn get_ai_model_by_id_internal(conn: &Connection, id: &str) -> Result<Option<AiModelRecord>> {
    let sql = format!("{AI_MODEL_SELECT_SQL} WHERE id = ?1 LIMIT 1");
    conn.query_row(&sql, params![id], map_ai_model_row)
        .optional()
        .map_err(Into::into)
}

fn get_default_ai_model_internal(
    conn: &Connection,
    category: &str,
) -> Result<Option<AiModelRecord>> {
    let sql = format!(
        "{AI_MODEL_SELECT_SQL} WHERE category = ?1 AND enabled = 1 AND is_default = 1 LIMIT 1"
    );
    conn.query_row(&sql, params![category], map_ai_model_row)
        .optional()
        .map_err(Into::into)
}

fn list_ai_models_internal(
    conn: &Connection,
    category: Option<&str>,
    enabled_only: bool,
) -> Result<Vec<AiModelRecord>> {
    let mut sql = format!("{AI_MODEL_SELECT_SQL} WHERE 1 = 1");
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(category) = category {
        sql.push_str(" AND category = ?");
        params.push(Box::new(category.to_string()));
    }

    if enabled_only {
        sql.push_str(" AND enabled = 1");
    }

    sql.push_str(" ORDER BY category ASC, updated_at DESC, model_id COLLATE NOCASE ASC");

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|param| param.as_ref()).collect();
    let rows = stmt.query_map(param_refs.as_slice(), map_ai_model_row)?;

    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn clear_default_for_category(
    tx: &Transaction<'_>,
    category: &str,
    exclude_id: Option<&str>,
) -> Result<()> {
    match exclude_id {
        Some(id) => {
            tx.execute(
                "UPDATE ai_models SET is_default = 0 WHERE category = ?1 AND id <> ?2",
                params![category, id],
            )?;
        }
        None => {
            tx.execute(
                "UPDATE ai_models SET is_default = 0 WHERE category = ?1",
                params![category],
            )?;
        }
    }

    Ok(())
}

fn ensure_enabled_default_for_category(
    tx: &Transaction<'_>,
    category: &str,
    updated_at: i64,
) -> Result<()> {
    let existing_default = tx
        .query_row(
            "SELECT id FROM ai_models WHERE category = ?1 AND enabled = 1 AND is_default = 1 LIMIT 1",
            params![category],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    if existing_default.is_some() {
        return Ok(());
    }

    let fallback_id = tx
        .query_row(
            "
            SELECT id
            FROM ai_models
            WHERE category = ?1 AND enabled = 1
            ORDER BY updated_at DESC, model_id COLLATE NOCASE ASC
            LIMIT 1
            ",
            params![category],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    if let Some(id) = fallback_id {
        tx.execute(
            "UPDATE ai_models SET is_default = 1, updated_at = ?1 WHERE id = ?2",
            params![updated_at, id],
        )?;
    }

    Ok(())
}

fn insert_ai_model(
    tx: &Transaction<'_>,
    id: &str,
    model: &SanitizedAiModelInput,
    created_at: i64,
    updated_at: i64,
) -> Result<()> {
    tx.execute(
        "
        INSERT INTO ai_models (
            id,
            category,
            base_url,
            model_id,
            api_key,
            temperature,
            max_tokens,
            capabilities_json,
            params_json,
            enabled,
            is_default,
            created_at,
            updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        ",
        params![
            id,
            &model.category,
            &model.base_url,
            &model.model_id,
            &model.api_key,
            model.temperature,
            model.max_tokens,
            &model.capabilities_json,
            &model.params_json,
            model.enabled,
            model.is_default,
            created_at,
            updated_at,
        ],
    )?;

    Ok(())
}

fn create_ai_model_internal(
    conn: &mut Connection,
    input: CreateAiModelInput,
) -> Result<AiModelRecord> {
    let mut model = sanitize_create_input(input)?;

    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    let tx = conn.transaction()?;
    if model.enabled && !model.is_default {
        let existing_default = tx
            .query_row(
                "SELECT id FROM ai_models WHERE category = ?1 AND enabled = 1 AND is_default = 1 LIMIT 1",
                params![&model.category],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        model.is_default = existing_default.is_none();
    }

    if model.is_default {
        clear_default_for_category(&tx, &model.category, None)?;
    }
    insert_ai_model(&tx, &id, &model, now, now)?;
    tx.commit()?;

    get_ai_model_by_id_internal(conn, &id)?.ok_or_else(|| {
        DbError::from("AI model was created but could not be loaded back from the database")
    })
}

fn update_ai_model_internal(
    conn: &mut Connection,
    input: UpdateAiModelInput,
) -> Result<AiModelRecord> {
    let (id, model) = sanitize_update_input(input)?;
    let existing = get_ai_model_by_id_internal(conn, &id)?
        .ok_or_else(|| DbError::from(format!("AI model not found: {id}")))?;

    let now = chrono::Utc::now().timestamp_millis();
    let tx = conn.transaction()?;
    if model.is_default {
        clear_default_for_category(&tx, &model.category, Some(&id))?;
    }

    let updated_rows = tx.execute(
        "
        UPDATE ai_models
        SET
            category = ?1,
            base_url = ?2,
            model_id = ?3,
            api_key = ?4,
            temperature = ?5,
            max_tokens = ?6,
            capabilities_json = ?7,
            params_json = ?8,
            enabled = ?9,
            is_default = ?10,
            updated_at = ?11
        WHERE id = ?12
        ",
        params![
            &model.category,
            &model.base_url,
            &model.model_id,
            &model.api_key,
            model.temperature,
            model.max_tokens,
            &model.capabilities_json,
            &model.params_json,
            model.enabled,
            model.is_default,
            now,
            &id,
        ],
    )?;

    if updated_rows == 0 {
        return Err(DbError::from(format!(
            "AI model not found: {}",
            existing.id
        )));
    }

    ensure_enabled_default_for_category(&tx, &existing.category, now)?;
    if existing.category != model.category {
        ensure_enabled_default_for_category(&tx, &model.category, now)?;
    }

    tx.commit()?;

    get_ai_model_by_id_internal(conn, &existing.id)?.ok_or_else(|| {
        DbError::from("AI model was updated but could not be loaded back from the database")
    })
}

fn delete_ai_model_internal(conn: &mut Connection, id: &str) -> Result<()> {
    let existing = get_ai_model_by_id_internal(conn, id)?
        .ok_or_else(|| DbError::from(format!("AI model not found: {id}")))?;

    let now = chrono::Utc::now().timestamp_millis();
    let tx = conn.transaction()?;
    let deleted = tx.execute("DELETE FROM ai_models WHERE id = ?1", params![id])?;
    if deleted == 0 {
        return Err(DbError::from(format!("AI model not found: {id}")));
    }

    if existing.is_default {
        ensure_enabled_default_for_category(&tx, &existing.category, now)?;
    }

    tx.commit()?;
    Ok(())
}

fn set_default_ai_model_internal(conn: &mut Connection, id: &str) -> Result<AiModelRecord> {
    let id = normalize_non_empty("AI model id", id)?;
    let (category, enabled): (String, bool) = conn
        .query_row(
            "SELECT category, enabled FROM ai_models WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| DbError::from(format!("AI model not found: {id}")))?;

    if !enabled {
        return Err(DbError::from(
            "Disabled AI models cannot be marked as default",
        ));
    }

    let tx = conn.transaction()?;
    clear_default_for_category(&tx, &category, None)?;
    tx.execute(
        "UPDATE ai_models SET is_default = 1, updated_at = ?1 WHERE id = ?2",
        params![chrono::Utc::now().timestamp_millis(), id],
    )?;
    tx.commit()?;

    get_ai_model_by_id_internal(conn, &id)?.ok_or_else(|| {
        DbError::from(
            "AI model was marked as default but could not be loaded back from the database",
        )
    })
}

#[tauri::command]
pub fn list_ai_models(
    state: State<DbState>,
    category: Option<String>,
    enabled_only: Option<bool>,
) -> Result<Vec<AiModelRecord>> {
    let conn = state.conn.lock()?;
    let category = category.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    let category = category.as_deref().map(normalize_category).transpose()?;
    list_ai_models_internal(&conn, category.as_deref(), enabled_only.unwrap_or(false))
}

#[tauri::command]
pub fn get_ai_model(state: State<DbState>, id: String) -> Result<Option<AiModelRecord>> {
    let conn = state.conn.lock()?;
    let id = normalize_non_empty("AI model id", &id)?;
    get_ai_model_by_id_internal(&conn, &id)
}

#[tauri::command]
pub fn create_ai_model(state: State<DbState>, input: CreateAiModelInput) -> Result<AiModelRecord> {
    let mut conn = state.conn.lock()?;
    create_ai_model_internal(&mut conn, input)
}

#[tauri::command]
pub fn update_ai_model(state: State<DbState>, input: UpdateAiModelInput) -> Result<AiModelRecord> {
    let mut conn = state.conn.lock()?;
    update_ai_model_internal(&mut conn, input)
}

#[tauri::command]
pub fn delete_ai_model(state: State<DbState>, id: String) -> Result<()> {
    let mut conn = state.conn.lock()?;
    let id = normalize_non_empty("AI model id", &id)?;
    delete_ai_model_internal(&mut conn, &id)
}

#[tauri::command]
pub fn get_default_ai_model(
    state: State<DbState>,
    category: String,
) -> Result<Option<AiModelRecord>> {
    let conn = state.conn.lock()?;
    let category = normalize_category(&category)?;
    get_default_ai_model_internal(&conn, &category)
}

#[tauri::command]
pub fn set_default_ai_model(state: State<DbState>, id: String) -> Result<AiModelRecord> {
    let mut conn = state.conn.lock()?;
    set_default_ai_model_internal(&mut conn, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_ai_models_table(conn: &Connection) {
        conn.execute_batch(
            "
            CREATE TABLE ai_models (
                id TEXT PRIMARY KEY,
                category TEXT NOT NULL,
                base_url TEXT NOT NULL,
                model_id TEXT NOT NULL,
                api_key TEXT NOT NULL,
                temperature REAL,
                max_tokens INTEGER,
                capabilities_json TEXT NOT NULL DEFAULT '{}',
                params_json TEXT NOT NULL DEFAULT '{}',
                enabled INTEGER NOT NULL DEFAULT 1,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            ",
        )
        .expect("create ai_models table");
    }

    fn create_input(model_id: &str) -> CreateAiModelInput {
        CreateAiModelInput {
            category: "chat".to_string(),
            base_url: "https://api.example.com/v1".to_string(),
            model_id: model_id.to_string(),
            api_key: "test-key".to_string(),
            temperature: Some(0.7),
            max_tokens: None,
            capabilities_json: None,
            params_json: None,
            enabled: Some(true),
            is_default: Some(false),
        }
    }

    #[test]
    fn normalize_json_object_accepts_objects_and_rejects_non_objects() {
        assert_eq!(
            normalize_json_object("params", Some("{\"a\":1}".into())).expect("valid object"),
            "{\"a\":1}"
        );
        assert_eq!(
            normalize_json_object("params", Some("".into())).expect("empty input should default"),
            "{}"
        );

        let err = normalize_json_object("params", Some("[1,2,3]".into()))
            .expect_err("arrays should be rejected");
        assert!(err.to_string().contains("must be a JSON object"));
    }

    #[test]
    fn first_enabled_model_is_auto_default() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        create_ai_models_table(&conn);

        let created =
            create_ai_model_internal(&mut conn, create_input("chat-a")).expect("create model");

        assert!(created.is_default);
    }

    #[test]
    fn deleting_default_promotes_next_enabled_model() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        create_ai_models_table(&conn);

        let first =
            create_ai_model_internal(&mut conn, create_input("chat-a")).expect("create first");
        let second =
            create_ai_model_internal(&mut conn, create_input("chat-b")).expect("create second");

        assert!(first.is_default);
        assert!(!second.is_default);

        delete_ai_model_internal(&mut conn, &first.id).expect("delete default");
        let promoted = get_ai_model_by_id_internal(&conn, &second.id)
            .expect("load promoted")
            .expect("promoted model exists");

        assert!(promoted.is_default);
    }

}
