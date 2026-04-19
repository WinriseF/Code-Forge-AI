use std::{
    fs,
    path::PathBuf,
    process,
    time::{SystemTime, UNIX_EPOCH},
};

use ctxrun_plugin_miner::core::postprocess::post_process_markdown;
use ctxrun_plugin_tool_runtime::{ToolCallRequest, ToolCallStatus, ToolRuntime, commands};
use serde_json::json;

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

fn ensure_success(
    response: &ctxrun_plugin_tool_runtime::ToolCallResponse,
    context: &str,
) -> serde_json::Value {
    assert_eq!(response.status, ToolCallStatus::Ok, "{context}");
    response
        .data
        .clone()
        .expect("tool response should contain data")
}

fn has_ripgrep() -> bool {
    std::process::Command::new("rg")
        .arg("--version")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

fn state_of<'a, T: Send + Sync + 'static>(value: &'a T) -> tauri::State<'a, T> {
    unsafe { std::mem::transmute::<&'a T, tauri::State<'a, T>>(value) }
}

#[test]
fn centralized_miner_postprocess_fixes_multiline_and_skip_links() {
    let input = "[Skip to Content](#main)\n[Multi\nline](url)";
    let expected = "\n[Multi\\\nline](url)";
    assert_eq!(post_process_markdown(input), expected);
}

#[test]
fn centralized_miner_postprocess_fixes_basic_multiline_link() {
    let input = "[This is a\nlong link](https://example.com)";
    let expected = "[This is a\\\nlong link](https://example.com)";
    assert_eq!(post_process_markdown(input), expected);
}

#[test]
fn centralized_miner_postprocess_fixes_nested_brackets_multiline() {
    let input = "[[nested\ntext]](url)";
    let expected = "[[nested\\\ntext]](url)";
    assert_eq!(post_process_markdown(input), expected);
}

#[test]
fn centralized_miner_postprocess_removes_skip_links_case_insensitive() {
    let input = "[SKIP TO CONTENT](#page)\n[skip to content](#skip)";
    let expected = "\n";
    assert_eq!(post_process_markdown(input), expected);
}

#[test]
fn centralized_miner_postprocess_preserves_non_skip_links() {
    let input = "[Normal Link](#section)\n[Skip to Main Content](#main)";
    let output = post_process_markdown(input);
    assert!(output.contains("[Normal Link](#section)"));
    assert!(output.contains("[Skip to Main Content](#main)"));
}

#[test]
fn centralized_runtime_registers_fs_tools_and_aliases() {
    let runtime = ToolRuntime::new();
    let names = runtime
        .list_tools()
        .into_iter()
        .map(|spec| spec.name)
        .collect::<std::collections::HashSet<_>>();

    for expected in [
        "read_file",
        "fs.read_file",
        "list_dir",
        "fs.list_directory",
        "grep_files",
        "fs.search_files",
    ] {
        assert!(names.contains(expected), "missing tool: {expected}");
    }
}

#[test]
fn centralized_runtime_command_wrapper_lists_registered_tools() {
    let runtime = ToolRuntime::new();
    let tools =
        commands::list_tools(state_of(&runtime)).expect("list tools through command wrapper");
    assert!(tools.iter().any(|tool| tool.name == "read_file"));
    assert!(!tools.iter().any(|tool| tool.name == "patch.preview_search_replace"));
}

#[tokio::test]
async fn centralized_runtime_command_wrapper_forwards_call_results() {
    let runtime = ToolRuntime::new();
    let response = commands::call_tool(
        state_of(&runtime),
        ToolCallRequest {
            name: "unknown.tool".to_string(),
            arguments: json!({}),
            approved: false,
        },
    )
    .await
    .expect("wrapper call should succeed");
    assert_eq!(response.status, ToolCallStatus::NotFound);
}

#[tokio::test]
async fn centralized_read_file_tool_respects_offset_and_limit() {
    let root = temp_root("read-file");
    let path = root.join("sample.txt");
    fs::write(&path, "a\nb\nc\n").expect("write sample");

    let runtime = ToolRuntime::new();
    let response = runtime
        .call_tool(ToolCallRequest {
            name: "read_file".to_string(),
            arguments: json!({
                "rootDir": root.to_string_lossy(),
                "filePath": "sample.txt",
                "offset": 2,
                "limit": 2
            }),
            approved: false,
        })
        .await;

    let data = ensure_success(&response, "read_file should succeed");
    let lines = data["lines"].as_array().expect("lines should be an array");
    assert_eq!(
        lines,
        &vec![json!("L2: b"), json!("L3: c")],
        "read_file should respect offset and limit"
    );
    assert_eq!(data["truncated"], json!(false));

    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn centralized_list_dir_tool_respects_depth_and_paging() {
    let root = temp_root("list-dir");
    let nested = root.join("nested");
    fs::create_dir_all(&nested).expect("create nested");
    fs::write(root.join("root.txt"), "root").expect("write root");
    fs::write(nested.join("child.txt"), "child").expect("write child");

    let runtime = ToolRuntime::new();
    let response = runtime
        .call_tool(ToolCallRequest {
            name: "list_dir".to_string(),
            arguments: json!({
                "rootDir": root.to_string_lossy(),
                "dirPath": ".",
                "offset": 1,
                "limit": 10,
                "depth": 2
            }),
            approved: false,
        })
        .await;

    let data = ensure_success(&response, "list_dir should succeed");
    let entries = data["entries"]
        .as_array()
        .expect("entries should be an array");
    assert_eq!(
        entries,
        &vec![
            json!("  nested/"),
            json!("    child.txt"),
            json!("  root.txt")
        ]
    );
    assert_eq!(data["totalEntries"], json!(3));
    assert_eq!(data["truncated"], json!(false));

    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn centralized_grep_files_respects_limit() {
    if !has_ripgrep() {
        return;
    }

    let root = temp_root("grep-limit");
    fs::write(root.join("a.rs"), "needle").expect("write a");
    fs::write(root.join("b.rs"), "needle").expect("write b");
    fs::write(root.join("c.rs"), "needle").expect("write c");

    let runtime = ToolRuntime::new();
    let response = runtime
        .call_tool(ToolCallRequest {
            name: "grep_files".to_string(),
            arguments: json!({
                "rootDir": root.to_string_lossy(),
                "pattern": "needle",
                "limit": 2
            }),
            approved: false,
        })
        .await;

    let data = ensure_success(&response, "grep_files should succeed");
    let matches = data["matches"]
        .as_array()
        .expect("matches should be an array");
    assert_eq!(matches.len(), 2, "grep_files should apply the limit");

    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn centralized_grep_files_exact_limit_is_not_truncated() {
    if !has_ripgrep() {
        return;
    }

    let root = temp_root("grep-exact-limit");
    fs::write(root.join("a.rs"), "needle").expect("write a");
    fs::write(root.join("b.rs"), "needle").expect("write b");
    fs::write(root.join("c.rs"), "needle").expect("write c");

    let runtime = ToolRuntime::new();
    let response = runtime
        .call_tool(ToolCallRequest {
            name: "grep_files".to_string(),
            arguments: json!({
                "rootDir": root.to_string_lossy(),
                "pattern": "needle",
                "limit": 3
            }),
            approved: false,
        })
        .await;

    let data = ensure_success(&response, "grep_files should succeed");
    let matches = data["matches"]
        .as_array()
        .expect("matches should be an array");
    assert_eq!(matches.len(), 3, "grep_files should return all matches");
    assert_eq!(
        data["truncated"].as_bool(),
        Some(false),
        "exactly limit matches should not be marked truncated"
    );

    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn centralized_runtime_reports_not_found_for_unknown_tool() {
    let runtime = ToolRuntime::new();
    let response = runtime
        .call_tool(ToolCallRequest {
            name: "unknown.tool".to_string(),
            arguments: json!({}),
            approved: false,
        })
        .await;

    assert_eq!(response.status, ToolCallStatus::NotFound);
}

#[tokio::test]
async fn centralized_read_file_rejects_zero_offset() {
    let root = temp_root("read-offset-zero");
    let path = root.join("sample.txt");
    fs::write(&path, "a\n").expect("write sample");

    let runtime = ToolRuntime::new();
    let response = runtime
        .call_tool(ToolCallRequest {
            name: "read_file".to_string(),
            arguments: json!({
                "rootDir": root.to_string_lossy(),
                "filePath": "sample.txt",
                "offset": 0,
                "limit": 1
            }),
            approved: false,
        })
        .await;

    assert_eq!(response.status, ToolCallStatus::Error);
    assert!(
        response
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("offset"),
        "error message should mention invalid offset"
    );

    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn centralized_read_file_rejects_empty_root_and_absolute_file_paths() {
    let root = temp_root("read-invalid-paths");
    let file = root.join("sample.txt");
    fs::write(&file, "hello\n").expect("write sample");

    let runtime = ToolRuntime::new();
    let empty_root = runtime
        .call_tool(ToolCallRequest {
            name: "read_file".to_string(),
            arguments: json!({
                "rootDir": "   ",
                "filePath": "sample.txt"
            }),
            approved: false,
        })
        .await;
    assert_eq!(empty_root.status, ToolCallStatus::Error);
    assert!(
        empty_root
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("rootDir cannot be empty")
    );

    let absolute_path = runtime
        .call_tool(ToolCallRequest {
            name: "read_file".to_string(),
            arguments: json!({
                "rootDir": root.to_string_lossy(),
                "filePath": file.to_string_lossy().to_string()
            }),
            approved: false,
        })
        .await;
    assert_eq!(absolute_path.status, ToolCallStatus::Error);
    assert!(
        absolute_path
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("Absolute filePath is not allowed")
    );

    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn centralized_read_file_rejects_parent_traversal_and_directory_targets() {
    let root = temp_root("read-directory-target");
    let nested = root.join("nested");
    let child = nested.join("sample.txt");
    fs::create_dir_all(&nested).expect("create nested dir");
    fs::write(&child, "hello\n").expect("write sample");

    let runtime = ToolRuntime::new();
    let traversal = runtime
        .call_tool(ToolCallRequest {
            name: "read_file".to_string(),
            arguments: json!({
                "rootDir": root.to_string_lossy(),
                "filePath": "../escape.txt"
            }),
            approved: false,
        })
        .await;
    assert_eq!(traversal.status, ToolCallStatus::Error);
    assert!(
        traversal
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("filePath cannot contain '..'")
    );

    let directory_target = runtime
        .call_tool(ToolCallRequest {
            name: "read_file".to_string(),
            arguments: json!({
                "rootDir": root.to_string_lossy(),
                "filePath": "nested"
            }),
            approved: false,
        })
        .await;
    assert_eq!(directory_target.status, ToolCallStatus::Error);
    assert!(
        directory_target
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("Target path is not a regular file")
    );

    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn centralized_list_dir_rejects_file_targets() {
    let root = temp_root("list-dir-file-target");
    let file = root.join("note.txt");
    fs::write(&file, "hello\n").expect("write sample");

    let runtime = ToolRuntime::new();
    let response = runtime
        .call_tool(ToolCallRequest {
            name: "list_dir".to_string(),
            arguments: json!({
                "rootDir": root.to_string_lossy(),
                "dirPath": "note.txt"
            }),
            approved: false,
        })
        .await;

    assert_eq!(response.status, ToolCallStatus::Error);
    assert!(
        response
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("Target path is not a directory")
    );

    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn centralized_list_dir_rejects_offset_beyond_entries() {
    let root = temp_root("list-offset-too-large");
    fs::write(root.join("a.txt"), "a").expect("write sample file");

    let runtime = ToolRuntime::new();
    let response = runtime
        .call_tool(ToolCallRequest {
            name: "list_dir".to_string(),
            arguments: json!({
                "rootDir": root.to_string_lossy(),
                "dirPath": ".",
                "offset": 99,
                "limit": 10,
                "depth": 1
            }),
            approved: false,
        })
        .await;

    assert_eq!(response.status, ToolCallStatus::Error);
    assert!(
        response
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("offset"),
        "error message should mention invalid offset"
    );

    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn centralized_grep_files_rejects_empty_pattern() {
    let root = temp_root("grep-empty-pattern");
    fs::write(root.join("a.txt"), "content").expect("write sample file");

    let runtime = ToolRuntime::new();
    let response = runtime
        .call_tool(ToolCallRequest {
            name: "grep_files".to_string(),
            arguments: json!({
                "rootDir": root.to_string_lossy(),
                "pattern": "   ",
                "limit": 10
            }),
            approved: false,
        })
        .await;

    assert_eq!(response.status, ToolCallStatus::Error);
    assert!(
        response
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("pattern"),
        "error message should mention empty pattern"
    );

    let _ = fs::remove_dir_all(root);
}
