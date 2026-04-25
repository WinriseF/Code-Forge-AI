use std::{
    fs,
    path::PathBuf,
    process,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use ctxrun_db::{
    ai_models,
    apps,
    init::DbState,
    models::{AppEntry, CreateAiModelInput, IgnoredSecret, ProjectConfig, Prompt, UpdateAiModelInput},
    project_config, prompts, secrets, shell_history, url_history,
};
use rusqlite::{Connection, params};

fn temp_root(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let root = std::env::temp_dir().join(format!(
        "ctxrun-workspace-tests-{prefix}-{}-{nanos}",
        process::id()
    ));
    fs::create_dir_all(&root).expect("create temp root");
    root
}

fn apply_db_migrations(conn: &Connection) {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let migrations_dir = manifest_dir
        .parent()
        .expect("workspace-tests should be inside crates/")
        .join("db")
        .join("migrations");

    let mut files = fs::read_dir(&migrations_dir)
        .expect("read migrations dir")
        .map(|e| e.expect("migration entry").path())
        .collect::<Vec<_>>();
    files.sort();

    for path in files {
        let sql = fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("failed to read migration {}: {e}", path.display()));
        conn.execute_batch(&sql)
            .unwrap_or_else(|e| panic!("failed to apply migration {}: {e}", path.display()));
    }
}

fn make_db_state() -> DbState {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    apply_db_migrations(&conn);
    DbState {
        conn: Mutex::new(conn),
    }
}

fn state_of<'a, T: Send + Sync + 'static>(value: &'a T) -> tauri::State<'a, T> {
    // SAFETY: `tauri::State<'a, T>` is a thin wrapper around `&'a T`.
    // We only use it in tests for directly invoking command functions.
    unsafe { std::mem::transmute::<&'a T, tauri::State<'a, T>>(value) }
}

fn sample_prompt(
    id: &str,
    title: &str,
    group: &str,
    typ: Option<&str>,
    is_favorite: bool,
    use_as_chat_template: bool,
) -> Prompt {
    Prompt {
        id: id.to_string(),
        title: title.to_string(),
        content: format!("content-{id}"),
        group_name: group.to_string(),
        description: Some(format!("desc-{id}")),
        tags: Some(vec!["tag1".into(), "tag2".into()]),
        is_favorite,
        created_at: 1,
        updated_at: 2,
        source: "local".to_string(),
        pack_id: None,
        original_id: None,
        type_: typ.map(str::to_string),
        is_executable: Some(false),
        shell_type: None,
        use_as_chat_template: Some(use_as_chat_template),
    }
}

fn sample_ai_model_input(name: &str, category: &str, is_default: bool) -> CreateAiModelInput {
    CreateAiModelInput {
        name: name.to_string(),
        category: category.to_string(),
        provider_name: "OpenAI".to_string(),
        base_url: "https://api.example.com/v1".to_string(),
        model_id: format!("{name}-model"),
        api_key: format!("key-{name}"),
        temperature: Some(0.7),
        max_tokens: Some(4096),
        capabilities_json: Some(r#"{"stream":true}"#.to_string()),
        params_json: Some(r#"{"reasoning_effort":"medium"}"#.to_string()),
        enabled: Some(true),
        is_default: Some(is_default),
        sort_order: Some(0),
        remark: Some(format!("remark-{name}")),
    }
}

#[test]
fn centralized_db_project_config_commands_roundtrip_export_import() {
    let db_state = make_db_state();
    let root = temp_root("db-project-config");
    let export_file = root.join("project-configs.json");
    let import_file = root.join("project-configs-import.json");

    let cfg = ProjectConfig {
        dirs: vec!["node_modules".into()],
        files: vec!["yarn.lock".into()],
        extensions: vec!["log".into()],
    };

    project_config::save_project_config(state_of(&db_state), "/proj/a".into(), cfg.clone())
        .expect("save project config");
    let loaded = project_config::get_project_config(state_of(&db_state), "/proj/a".into())
        .expect("get project config")
        .expect("config should exist");
    assert_eq!(loaded.dirs, cfg.dirs);

    {
        let conn = db_state.conn.lock().expect("lock db");
        conn.execute(
            "INSERT OR REPLACE INTO project_configs (path, config, updated_at) VALUES (?1, ?2, ?3)",
            params!["/broken", "{invalid-json", 3_i64],
        )
        .expect("insert invalid config row");
    }

    let exported = project_config::export_project_configs(
        state_of(&db_state),
        export_file.to_string_lossy().to_string(),
    )
    .expect("export configs");
    assert_eq!(exported, 2);

    let export_json = fs::read_to_string(&export_file).expect("read export file");
    let export_value: serde_json::Value = serde_json::from_str(&export_json).expect("valid json");
    let broken = export_value
        .as_array()
        .expect("array")
        .iter()
        .find(|item| item.get("path").and_then(|v| v.as_str()) == Some("/broken"))
        .expect("broken row present");
    assert_eq!(
        broken
            .get("config")
            .and_then(|c| c.get("dirs"))
            .and_then(|d| d.as_array())
            .map(|a| a.len()),
        Some(0),
        "invalid config json should fallback to empty default config"
    );

    fs::write(
        &import_file,
        r#"[{"path":"/proj/b","config":{"dirs":["dist"],"files":[],"extensions":["tmp"]},"updated_at":123}]"#,
    )
    .expect("write import file");

    let merged = project_config::import_project_configs(
        state_of(&db_state),
        import_file.to_string_lossy().to_string(),
        "merge".into(),
    )
    .expect("merge import");
    assert_eq!(merged, 1);
    let merged_cfg = project_config::get_project_config(state_of(&db_state), "/proj/b".into())
        .expect("get merged config")
        .expect("merged config should exist");
    assert_eq!(merged_cfg.dirs, vec!["dist".to_string()]);

    let overwritten = project_config::import_project_configs(
        state_of(&db_state),
        import_file.to_string_lossy().to_string(),
        "overwrite".into(),
    )
    .expect("overwrite import");
    assert_eq!(overwritten, 1);
    assert!(
        project_config::get_project_config(state_of(&db_state), "/proj/a".into())
            .expect("query old config")
            .is_none(),
        "overwrite import should clear previous rows first"
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_db_shell_history_commands_cover_recent_and_search_paths() {
    let db_state = make_db_state();

    shell_history::record_shell_command(state_of(&db_state), "   ".into())
        .expect("empty command should be accepted as no-op");
    shell_history::record_shell_command(state_of(&db_state), "cargo test -p ctxrun".into())
        .expect("record cargo command");
    shell_history::record_shell_command(state_of(&db_state), "cargo test -p ctxrun".into())
        .expect("record cargo command again");
    shell_history::record_shell_command(state_of(&db_state), "git status".into())
        .expect("record git command");

    let recent =
        shell_history::get_recent_shell_history(state_of(&db_state), 10).expect("recent history");
    assert_eq!(recent.len(), 2);
    assert!(recent.iter().any(|e| e.command == "cargo test -p ctxrun"));

    let empty_search = shell_history::search_shell_history(state_of(&db_state), "   ".into(), 10)
        .expect("empty query should fallback to recent");
    assert_eq!(empty_search.len(), 2);

    let search = shell_history::search_shell_history(state_of(&db_state), "cargo test".into(), 10)
        .expect("search shell history");
    assert!(!search.is_empty());
    assert!(search[0].command.contains("cargo test"));
}

#[test]
fn centralized_db_ai_model_commands_cover_crud_and_default_switching() {
    let db_state = make_db_state();

    let first = ai_models::create_ai_model(
        state_of(&db_state),
        sample_ai_model_input("Chat Primary", "chat", true),
    )
    .expect("create first ai model");
    let second = ai_models::create_ai_model(
        state_of(&db_state),
        sample_ai_model_input("Chat Backup", "chat", false),
    )
    .expect("create second ai model");

    let listed = ai_models::list_ai_models(state_of(&db_state), None, None).expect("list ai models");
    assert_eq!(listed.len(), 2);

    let default_chat = ai_models::get_default_ai_model(state_of(&db_state), "chat".into())
        .expect("get default chat model")
        .expect("default chat model should exist");
    assert_eq!(default_chat.id, first.id);

    let switched = ai_models::set_default_ai_model(state_of(&db_state), second.id.clone())
        .expect("switch default ai model");
    assert_eq!(switched.id, second.id);
    assert!(switched.is_default);

    let updated = ai_models::update_ai_model(
        state_of(&db_state),
        UpdateAiModelInput {
            id: second.id.clone(),
            name: "Chat Backup Updated".into(),
            category: "chat".into(),
            provider_name: "OpenAI".into(),
            base_url: "https://api.example.com/v1/".into(),
            model_id: "chat-backup-updated".into(),
            api_key: "key-chat-backup-updated".into(),
            temperature: Some(0.4),
            max_tokens: Some(2048),
            capabilities_json: Some("{\"stream\":true,\"tools\":true}".into()),
            params_json: Some("{\"reasoning_effort\":\"high\"}".into()),
            enabled: true,
            is_default: true,
            sort_order: Some(2),
            remark: Some("updated".into()),
        },
    )
    .expect("update ai model");
    assert_eq!(updated.name, "Chat Backup Updated");
    assert_eq!(updated.base_url, "https://api.example.com/v1");

    let fetched = ai_models::get_ai_model(state_of(&db_state), updated.id.clone())
        .expect("get ai model")
        .expect("ai model should exist");
    assert_eq!(fetched.params_json, "{\"reasoning_effort\":\"high\"}");

    ai_models::delete_ai_model(state_of(&db_state), first.id.clone()).expect("delete ai model");
    assert!(
        ai_models::get_ai_model(state_of(&db_state), first.id)
            .expect("query deleted ai model")
            .is_none(),
        "deleted ai model should not be returned"
    );
}

#[test]
fn centralized_db_url_history_search_covers_empty_short_and_fts_queries() {
    let db_state = make_db_state();
    {
        let conn = db_state.conn.lock().expect("lock db");
        conn.execute(
            "INSERT INTO url_history (url, title, visit_count, last_visit) VALUES (?1, ?2, ?3, ?4)",
            params!["https://example.com/docs", "Example Docs", 5_i64, 100_i64],
        )
        .expect("insert docs row");
        conn.execute(
            "INSERT INTO url_history (url, title, visit_count, last_visit) VALUES (?1, ?2, ?3, ?4)",
            params!["https://example.com/blog", "Example Blog", 2_i64, 200_i64],
        )
        .expect("insert blog row");
    }

    let recent = url_history::search_url_history(state_of(&db_state), "".into())
        .expect("empty query url history");
    assert_eq!(recent.len(), 2);
    assert_eq!(recent[0].url, "https://example.com/blog");

    let short = url_history::search_url_history(state_of(&db_state), "\"ex\"".into())
        .expect("short query url history");
    assert!(!short.is_empty());
    assert!(short[0].visit_count >= short[short.len() - 1].visit_count);

    let fts = url_history::search_url_history(state_of(&db_state), "example docs".into())
        .expect("fts query url history");
    assert!(!fts.is_empty());
    assert!(fts.iter().any(|i| i.url.contains("docs")));
}

#[test]
fn centralized_db_prompt_commands_cover_crud_search_counts_and_csv_paths() {
    let db_state = make_db_state();
    let root = temp_root("db-prompts");
    let csv_path = root.join("prompts.csv");

    let p1 = sample_prompt("p1", "Build Prompt", "dev", Some("prompt"), true, false);
    let p2 = sample_prompt("p2", "Run Command", "ops", Some("command"), false, true);

    prompts::save_prompt(state_of(&db_state), p1.clone()).expect("save p1");
    prompts::save_prompt(state_of(&db_state), p2.clone()).expect("save p2");

    let all = prompts::get_prompts(state_of(&db_state), 1, 20, "all".into(), None)
        .expect("get all prompts");
    assert_eq!(all.len(), 2);

    let fav = prompts::get_prompts(state_of(&db_state), 1, 20, "favorite".into(), None)
        .expect("get favorites");
    assert_eq!(fav.len(), 1);
    assert_eq!(fav[0].id, "p1");

    let prompt_category = prompts::get_prompts(
        state_of(&db_state),
        1,
        20,
        "all".into(),
        Some("prompt".into()),
    )
    .expect("get prompt category");
    assert_eq!(prompt_category.len(), 1);
    assert_eq!(prompt_category[0].id, "p1");

    let search_hits = prompts::search_prompts(
        state_of(&db_state),
        "Run".into(),
        1,
        20,
        Some("command".into()),
    )
    .expect("search prompts");
    assert_eq!(search_hits.len(), 1);
    assert_eq!(search_hits[0].id, "p2");

    prompts::toggle_prompt_favorite(state_of(&db_state), "p2".into()).expect("toggle favorite");
    let fav_after_toggle =
        prompts::get_prompts(state_of(&db_state), 1, 20, "favorite".into(), None)
            .expect("favorites after toggle");
    assert_eq!(fav_after_toggle.len(), 2);

    let groups = prompts::get_prompt_groups(state_of(&db_state)).expect("prompt groups");
    assert!(groups.contains(&"dev".to_string()));
    assert!(groups.contains(&"ops".to_string()));

    let counts = prompts::get_prompt_counts(state_of(&db_state)).expect("prompt counts");
    assert_eq!(counts.prompt, 1);
    assert_eq!(counts.command, 1);

    let templates = prompts::get_chat_templates(state_of(&db_state)).expect("chat templates");
    assert_eq!(templates.len(), 1);
    assert_eq!(templates[0].id, "p2");

    let exported =
        prompts::export_prompts_to_csv(state_of(&db_state), csv_path.to_string_lossy().to_string())
            .expect("export prompts csv");
    assert_eq!(exported, 2);

    prompts::delete_prompt(state_of(&db_state), "p1".into()).expect("delete p1");
    let after_delete = prompts::get_prompts(state_of(&db_state), 1, 20, "all".into(), None)
        .expect("prompts after delete");
    assert_eq!(after_delete.len(), 1);

    let imported_merge = prompts::import_prompts_from_csv(
        state_of(&db_state),
        csv_path.to_string_lossy().to_string(),
        "merge".into(),
    )
    .expect("import prompts csv merge");
    assert!(imported_merge >= 1);

    let imported_overwrite = prompts::import_prompts_from_csv(
        state_of(&db_state),
        csv_path.to_string_lossy().to_string(),
        "overwrite".into(),
    )
    .expect("import prompts csv overwrite");
    assert!(imported_overwrite >= 1);

    let pack_prompts = vec![sample_prompt(
        "pack-1",
        "Pack Prompt",
        "pack",
        Some("prompt"),
        false,
        false,
    )];
    prompts::import_prompt_pack(state_of(&db_state), "pack-alpha".into(), pack_prompts)
        .expect("import prompt pack");

    let local_prompts = vec![
        sample_prompt(
            "local-1",
            "Local One",
            "local",
            Some("prompt"),
            false,
            false,
        ),
        sample_prompt(
            "local-1",
            "Local One Dup",
            "local",
            Some("prompt"),
            false,
            false,
        ),
    ];
    let imported_local = prompts::batch_import_local_prompts(state_of(&db_state), local_prompts)
        .expect("batch import local prompts");
    assert_eq!(imported_local, 2);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn centralized_db_ignored_secrets_commands_cover_add_get_delete() {
    let db_state = make_db_state();

    let inserted = secrets::add_ignored_secrets(
        state_of(&db_state),
        vec![
            IgnoredSecret {
                id: String::new(),
                value: "sk-test-secret-1".into(),
                rule_id: Some("openai-api-key".into()),
                created_at: 0,
            },
            IgnoredSecret {
                id: "custom-id".into(),
                value: "sk-test-secret-2".into(),
                rule_id: None,
                created_at: 0,
            },
        ],
    )
    .expect("add ignored secrets");
    assert_eq!(inserted, 2);

    let mut rows = secrets::get_ignored_secrets(state_of(&db_state)).expect("get ignored secrets");
    assert_eq!(rows.len(), 2);

    rows.sort_by(|a, b| a.id.cmp(&b.id));
    let delete_id = rows[0].id.clone();
    secrets::delete_ignored_secret(state_of(&db_state), delete_id).expect("delete ignored secret");

    let after_delete =
        secrets::get_ignored_secrets(state_of(&db_state)).expect("get ignored after delete");
    assert_eq!(after_delete.len(), 1);
}

#[test]
fn centralized_db_app_commands_cover_search_and_usage_updates() {
    let db_state = make_db_state();
    {
        let conn = db_state.conn.lock().expect("lock db");
        conn.execute(
            "INSERT INTO apps (path, name, keywords, icon, usage_count, last_used_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                "/apps/code.exe",
                "Code Editor",
                "code editor typescript",
                "icon-code",
                4_i64,
                10_i64
            ],
        )
        .expect("insert code app");
        conn.execute(
            "INSERT INTO apps (path, name, keywords, icon, usage_count, last_used_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                "/apps/coderunner.exe",
                "Code Runner",
                "runner terminal",
                "icon-runner",
                7_i64,
                20_i64
            ],
        )
        .expect("insert runner app");
    }

    let results =
        apps::search_apps_in_db(state_of(&db_state), " code ".into()).expect("search apps in db");
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].name, "Code Runner");
    assert_eq!(results[1].name, "Code Editor");

    apps::record_app_usage(state_of(&db_state), "/apps/code.exe".into()).expect("record app usage");
    let updated =
        apps::search_apps_in_db(state_of(&db_state), "editor".into()).expect("search updated app");
    assert_eq!(updated.len(), 1);
    assert_eq!(updated[0].path, "/apps/code.exe");
    assert_eq!(updated[0].usage_count, 5);

    let inserted = apps::sync_scanned_apps(
        &db_state.conn.lock().expect("lock db"),
        vec![AppEntry {
            name: "New Tool".into(),
            path: "/apps/new-tool.exe".into(),
            icon: Some("icon-tool".into()),
            usage_count: 0,
        }],
    )
    .expect("sync scanned apps");
    assert_eq!(inserted, 1);
}
