use ctxrun_plugin_git::{
    export::generate_export_content,
    models::{ExportFormat, ExportLayout, GitDiffFile},
};
use serde_json::Value;

fn sample_file() -> GitDiffFile {
    GitDiffFile {
        path: "src/main.rs".to_string(),
        status: "modified".to_string(),
        old_path: None,
        original_content: "fn main() {\n    println!(\"old\");\n}\n".to_string(),
        modified_content: "fn main() {\n    println!(\"new\");\n}\n".to_string(),
        is_binary: false,
        is_large: false,
        additions: 1,
        deletions: 1,
    }
}

#[test]
fn centralized_git_export_markdown_unified_contains_diff_markers() {
    let output = generate_export_content(
        vec![sample_file()],
        ExportFormat::Markdown,
        ExportLayout::Unified,
    );
    assert!(output.contains("# Git Diff Export"));
    assert!(output.contains("### Full Context Diff"));
    assert!(output.contains("-    println!(\"old\");"));
    assert!(output.contains("+    println!(\"new\");"));
}

#[test]
fn centralized_git_export_json_split_has_original_and_modified() {
    let output =
        generate_export_content(vec![sample_file()], ExportFormat::Json, ExportLayout::Split);
    let parsed: Value = serde_json::from_str(&output).expect("valid json export");
    let arr = parsed.as_array().expect("top-level should be array");
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["path"], Value::String("src/main.rs".to_string()));
    assert_eq!(arr[0]["layout"], Value::String("Split".to_string()));
    assert!(arr[0]["content"]["original"].is_string());
    assert!(arr[0]["content"]["modified"].is_string());
}

#[test]
fn centralized_git_export_xml_gitpatch_includes_git_headers() {
    let output = generate_export_content(
        vec![sample_file()],
        ExportFormat::Xml,
        ExportLayout::GitPatch,
    );
    assert!(output.contains("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
    assert!(output.contains("<git_diff_export>"));
    assert!(output.contains("diff --git a/src/main.rs b/src/main.rs"));
    assert!(output.contains("</git_diff_export>"));
}

#[test]
fn centralized_git_export_txt_split_contains_section_headers() {
    let output =
        generate_export_content(vec![sample_file()], ExportFormat::Txt, ExportLayout::Split);
    assert!(output.contains("FILE: src/main.rs  STATUS: modified"));
    assert!(output.contains("<<<<<<<< ORIGINAL VERSION START"));
    assert!(output.contains("<<<<<<<< MODIFIED VERSION START"));
}
