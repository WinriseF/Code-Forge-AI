use std::{
    collections::{HashMap, HashSet},
    fs,
};

use rusqlite::{Connection, OptionalExtension, Row, Transaction, params};
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, State};
use uuid::Uuid;

use super::{
    error::{DbError, Result},
    init::DbState,
    models::{AiModelRecord, CreateAiModelInput, UpdateAiModelInput},
};

const AI_MODEL_SELECT_SQL: &str = "
    SELECT
        id,
        name,
        category,
        provider_name,
        base_url,
        model_id,
        api_key,
        temperature,
        max_tokens,
        capabilities_json,
        params_json,
        enabled,
        is_default,
        sort_order,
        remark,
        created_at,
        updated_at
    FROM ai_models
";
const LEGACY_APP_CONFIG_FILE: &str = "app-config.json";
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
    name: String,
    category: String,
    provider_name: String,
    base_url: String,
    model_id: String,
    api_key: String,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
    capabilities_json: String,
    params_json: String,
    enabled: bool,
    is_default: bool,
    sort_order: i64,
    remark: String,
}

#[derive(Debug, Deserialize, Default)]
struct LegacyAppConfigStore {
    #[serde(default)]
    state: LegacyAppConfigState,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct LegacyAppConfigState {
    #[serde(default)]
    ai_config: Option<LegacyAiConfig>,
    #[serde(default)]
    saved_provider_settings: HashMap<String, LegacyAiProviderSetting>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct LegacyAiConfig {
    #[serde(default)]
    provider_id: String,
    #[serde(default)]
    api_key: String,
    base_url: Option<String>,
    #[serde(default)]
    model_id: String,
    temperature: Option<f64>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct LegacyAiProviderSetting {
    #[serde(default)]
    api_key: String,
    base_url: Option<String>,
    #[serde(default)]
    model_id: String,
    temperature: Option<f64>,
}

#[derive(Debug, Clone)]
struct LegacyImportCandidate {
    name: String,
    category: String,
    provider_name: String,
    base_url: String,
    model_id: String,
    api_key: String,
    temperature: Option<f64>,
    is_active: bool,
}

fn map_ai_model_row(row: &Row<'_>) -> rusqlite::Result<AiModelRecord> {
    Ok(AiModelRecord {
        id: row.get("id")?,
        name: row.get("name")?,
        category: row.get("category")?,
        provider_name: row.get("provider_name")?,
        base_url: row.get("base_url")?,
        model_id: row.get("model_id")?,
        api_key: row.get("api_key")?,
        temperature: row.get("temperature")?,
        max_tokens: row.get("max_tokens")?,
        capabilities_json: row.get("capabilities_json")?,
        params_json: row.get("params_json")?,
        enabled: row.get("enabled")?,
        is_default: row.get("is_default")?,
        sort_order: row.get("sort_order")?,
        remark: row.get("remark")?,
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
        name: normalize_non_empty("AI model name", &input.name)?,
        category: normalize_category(&input.category)?,
        provider_name: normalize_non_empty("AI model provider name", &input.provider_name)?,
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
        sort_order: input.sort_order.unwrap_or(0),
        remark: input.remark.unwrap_or_default().trim().to_string(),
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
            name: normalize_non_empty("AI model name", &input.name)?,
            category: normalize_category(&input.category)?,
            provider_name: normalize_non_empty("AI model provider name", &input.provider_name)?,
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
            sort_order: input.sort_order.unwrap_or(0),
            remark: input.remark.unwrap_or_default().trim().to_string(),
        },
    ))
}

fn ensure_unique_name(conn: &Connection, name: &str, exclude_id: Option<&str>) -> Result<()> {
    let existing_id = match exclude_id {
        Some(id) => conn
            .query_row(
                "SELECT id FROM ai_models WHERE name = ?1 COLLATE NOCASE AND id <> ?2 LIMIT 1",
                params![name, id],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
        None => conn
            .query_row(
                "SELECT id FROM ai_models WHERE name = ?1 COLLATE NOCASE LIMIT 1",
                params![name],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
    };

    if existing_id.is_some() {
        return Err(DbError::from(format!(
            "AI model name already exists: {name}"
        )));
    }

    Ok(())
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

    sql.push_str(
        " ORDER BY category ASC, sort_order ASC, updated_at DESC, name COLLATE NOCASE ASC",
    );

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
            name,
            category,
            provider_name,
            base_url,
            model_id,
            api_key,
            temperature,
            max_tokens,
            capabilities_json,
            params_json,
            enabled,
            is_default,
            sort_order,
            remark,
            created_at,
            updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
        ",
        params![
            id,
            &model.name,
            &model.category,
            &model.provider_name,
            &model.base_url,
            &model.model_id,
            &model.api_key,
            model.temperature,
            model.max_tokens,
            &model.capabilities_json,
            &model.params_json,
            model.enabled,
            model.is_default,
            model.sort_order,
            &model.remark,
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
    let model = sanitize_create_input(input)?;
    ensure_unique_name(conn, &model.name, None)?;

    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    let tx = conn.transaction()?;
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
    ensure_unique_name(conn, &model.name, Some(&id))?;

    let now = chrono::Utc::now().timestamp_millis();
    let tx = conn.transaction()?;
    if model.is_default {
        clear_default_for_category(&tx, &model.category, Some(&id))?;
    }

    let updated_rows = tx.execute(
        "
        UPDATE ai_models
        SET
            name = ?1,
            category = ?2,
            provider_name = ?3,
            base_url = ?4,
            model_id = ?5,
            api_key = ?6,
            temperature = ?7,
            max_tokens = ?8,
            capabilities_json = ?9,
            params_json = ?10,
            enabled = ?11,
            is_default = ?12,
            sort_order = ?13,
            remark = ?14,
            updated_at = ?15
        WHERE id = ?16
        ",
        params![
            &model.name,
            &model.category,
            &model.provider_name,
            &model.base_url,
            &model.model_id,
            &model.api_key,
            model.temperature,
            model.max_tokens,
            &model.capabilities_json,
            &model.params_json,
            model.enabled,
            model.is_default,
            model.sort_order,
            &model.remark,
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

    tx.commit()?;

    get_ai_model_by_id_internal(conn, &existing.id)?.ok_or_else(|| {
        DbError::from("AI model was updated but could not be loaded back from the database")
    })
}

fn delete_ai_model_internal(conn: &Connection, id: &str) -> Result<()> {
    let deleted = conn.execute("DELETE FROM ai_models WHERE id = ?1", params![id])?;
    if deleted == 0 {
        return Err(DbError::from(format!("AI model not found: {id}")));
    }

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

fn infer_category(name: &str, model_id: &str) -> String {
    let source = format!(
        "{} {}",
        name.to_ascii_lowercase(),
        model_id.to_ascii_lowercase()
    );

    if source.contains("translate") || source.contains("translation") || source.contains("mt") {
        return "translation".to_string();
    }

    if source.contains("code") || source.contains("coding") {
        return "coding".to_string();
    }

    if source.contains("vision") || source.contains("image") || source.contains("vl") {
        return "vision".to_string();
    }

    "chat".to_string()
}

fn build_legacy_import_candidates(state: &LegacyAppConfigState) -> Vec<LegacyImportCandidate> {
    let active_provider = state
        .ai_config
        .as_ref()
        .map(|config| config.provider_id.trim().to_string())
        .filter(|provider_id| !provider_id.is_empty());

    let mut entries: Vec<(String, LegacyAiProviderSetting)> = state
        .saved_provider_settings
        .iter()
        .map(|(name, config)| (name.clone(), config.clone()))
        .collect();
    entries.sort_by(|left, right| {
        left.0
            .to_ascii_lowercase()
            .cmp(&right.0.to_ascii_lowercase())
    });

    let mut seen_names = HashSet::new();
    let mut candidates = Vec::new();

    for (name, config) in entries {
        let trimmed_name = name.trim().to_string();
        let normalized_name = trimmed_name.to_ascii_lowercase();
        if trimmed_name.is_empty() || !seen_names.insert(normalized_name) {
            continue;
        }

        if config.api_key.trim().is_empty()
            || config.model_id.trim().is_empty()
            || config
                .base_url
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
        {
            continue;
        }

        candidates.push(LegacyImportCandidate {
            category: infer_category(&trimmed_name, &config.model_id),
            provider_name: trimmed_name.clone(),
            name: trimmed_name.clone(),
            base_url: config.base_url.unwrap_or_default(),
            model_id: config.model_id,
            api_key: config.api_key,
            temperature: config.temperature,
            is_active: active_provider.as_deref() == Some(trimmed_name.as_str()),
        });
    }

    if let Some(active) = &state.ai_config {
        let active_name = active.provider_id.trim();
        let has_active_entry = candidates
            .iter()
            .any(|candidate| candidate.name == active_name);
        if !has_active_entry
            && !active_name.is_empty()
            && !active.api_key.trim().is_empty()
            && !active.model_id.trim().is_empty()
            && !active
                .base_url
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
        {
            candidates.push(LegacyImportCandidate {
                category: infer_category(active_name, &active.model_id),
                provider_name: active_name.to_string(),
                name: active_name.to_string(),
                base_url: active.base_url.clone().unwrap_or_default(),
                model_id: active.model_id.clone(),
                api_key: active.api_key.clone(),
                temperature: active.temperature,
                is_active: true,
            });
        }
    }

    candidates.sort_by(|left, right| {
        right.is_active.cmp(&left.is_active).then_with(|| {
            left.name
                .to_ascii_lowercase()
                .cmp(&right.name.to_ascii_lowercase())
        })
    });
    candidates
}

fn import_legacy_ai_models_from_state(
    conn: &mut Connection,
    state: LegacyAppConfigState,
) -> Result<usize> {
    let existing_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM ai_models", [], |row| row.get(0))?;
    if existing_count > 0 {
        return Ok(0);
    }

    let candidates = build_legacy_import_candidates(&state);
    if candidates.is_empty() {
        return Ok(0);
    }

    let active_default_categories: HashSet<String> = candidates
        .iter()
        .filter(|candidate| candidate.is_active)
        .map(|candidate| candidate.category.clone())
        .collect();
    let mut assigned_default_categories = HashSet::new();
    let now = chrono::Utc::now().timestamp_millis();

    let tx = conn.transaction()?;
    let mut inserted = 0;

    for (index, candidate) in candidates.into_iter().enumerate() {
        let is_default = if candidate.is_active {
            assigned_default_categories.insert(candidate.category.clone());
            true
        } else if !active_default_categories.contains(&candidate.category)
            && assigned_default_categories.insert(candidate.category.clone())
        {
            true
        } else {
            false
        };

        let model = sanitize_create_input(CreateAiModelInput {
            name: candidate.name,
            category: candidate.category,
            provider_name: candidate.provider_name,
            base_url: candidate.base_url,
            model_id: candidate.model_id,
            api_key: candidate.api_key,
            temperature: candidate.temperature,
            max_tokens: None,
            capabilities_json: Some("{}".to_string()),
            params_json: Some("{}".to_string()),
            enabled: Some(true),
            is_default: Some(is_default),
            sort_order: Some(index as i64),
            remark: Some("Imported from legacy app-config.json".to_string()),
        })?;

        insert_ai_model(&tx, &Uuid::new_v4().to_string(), &model, now, now)?;
        inserted += 1;
    }

    tx.commit()?;
    Ok(inserted)
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
    let conn = state.conn.lock()?;
    let id = normalize_non_empty("AI model id", &id)?;
    delete_ai_model_internal(&conn, &id)
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

pub fn import_legacy_ai_models_from_app_handle<R: Runtime>(
    conn: &mut Connection,
    app: &AppHandle<R>,
) -> Result<usize> {
    let app_dir = app.path().app_local_data_dir().map_err(|err| {
        DbError::from(format!("Failed to locate app local data directory: {err}"))
    })?;
    let config_path = app_dir.join(LEGACY_APP_CONFIG_FILE);
    if !config_path.exists() {
        return Ok(0);
    }

    let content = fs::read_to_string(&config_path)?;
    let store: LegacyAppConfigStore = serde_json::from_str(&content)?;
    import_legacy_ai_models_from_state(conn, store.state)
}

#[tauri::command]
pub fn import_legacy_ai_models_if_needed(state: State<DbState>, app: AppHandle) -> Result<usize> {
    let mut conn = state.conn.lock()?;
    import_legacy_ai_models_from_app_handle(&mut conn, &app)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_ai_models_table(conn: &Connection) {
        conn.execute_batch(
            "
            CREATE TABLE ai_models (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                provider_name TEXT NOT NULL,
                base_url TEXT NOT NULL,
                model_id TEXT NOT NULL,
                api_key TEXT NOT NULL,
                temperature REAL,
                max_tokens INTEGER,
                capabilities_json TEXT NOT NULL DEFAULT '{}',
                params_json TEXT NOT NULL DEFAULT '{}',
                enabled INTEGER NOT NULL DEFAULT 1,
                is_default INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                remark TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            ",
        )
        .expect("create ai_models table");
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
    fn import_legacy_ai_models_assigns_defaults_and_is_idempotent() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        create_ai_models_table(&conn);

        let inserted = import_legacy_ai_models_from_state(
            &mut conn,
            LegacyAppConfigState {
                ai_config: Some(LegacyAiConfig {
                    provider_id: "Minimax".into(),
                    api_key: "ms-active".into(),
                    base_url: Some("https://api.example.com/v1".into()),
                    model_id: "Qwen/Qwen3.5".into(),
                    temperature: Some(0.2),
                }),
                saved_provider_settings: HashMap::from([
                    (
                        "MT".into(),
                        LegacyAiProviderSetting {
                            api_key: "sk-mt".into(),
                            base_url: Some("https://api.translation.local/v1".into()),
                            model_id: "translate-v1".into(),
                            temperature: Some(0.1),
                        },
                    ),
                    (
                        "Minimax".into(),
                        LegacyAiProviderSetting {
                            api_key: "ms-active".into(),
                            base_url: Some("https://api.example.com/v1".into()),
                            model_id: "Qwen/Qwen3.5".into(),
                            temperature: Some(0.2),
                        },
                    ),
                ]),
            },
        )
        .expect("import legacy ai models");

        assert_eq!(inserted, 2);

        let defaults = list_ai_models_internal(&conn, None, false).expect("list ai models");
        let translation_default = defaults
            .iter()
            .find(|model| model.category == "translation")
            .expect("translation model should exist");
        let chat_default = defaults
            .iter()
            .find(|model| model.category == "chat")
            .expect("chat model should exist");

        assert!(translation_default.is_default);
        assert!(chat_default.is_default);
        assert_eq!(chat_default.name, "Minimax");

        let repeated =
            import_legacy_ai_models_from_state(&mut conn, LegacyAppConfigState::default())
                .expect("repeat import should no-op when records already exist");
        assert_eq!(repeated, 0);
    }
}
