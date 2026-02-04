use serde::{Deserialize, Serialize};

// ============================================================================
// Data Models
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    pub id: String,
    pub title: String,
    pub content: String,
    #[serde(rename = "group")]
    pub group_name: String,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub is_favorite: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub source: String,
    pub pack_id: Option<String>,
    pub original_id: Option<String>,
    #[serde(rename = "type")]
    pub type_: Option<String>,
    pub is_executable: Option<bool>,
    pub shell_type: Option<String>,
    pub use_as_chat_template: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UrlHistoryItem {
    pub url: String,
    pub title: Option<String>,
    pub visit_count: i64,
    pub last_visit: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectConfig {
    pub dirs: Vec<String>,
    pub files: Vec<String>,
    pub extensions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IgnoredSecret {
    pub id: String,
    pub value: String,
    pub rule_id: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppEntry {
    pub name: String,
    pub path: String,
    pub icon: Option<String>,
    pub usage_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShellHistoryEntry {
    pub id: i64,
    pub command: String,
    pub timestamp: i64,
    pub execution_count: i64,
}

#[derive(serde::Serialize)]
pub struct PromptCounts {
    pub prompt: i64,
    pub command: i64,
}

// ============================================================================
// CSV Export/Import Models
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct PromptCsvRow {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    pub content: String,
    #[serde(rename = "group")]
    pub group_name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub tags: String,
    #[serde(default)]
    pub is_favorite: bool,
    #[serde(rename = "type", default = "default_type")]
    pub type_: String,
    #[serde(default)]
    pub is_executable: bool,
    pub shell_type: Option<String>,
}

#[allow(dead_code)]
fn default_type() -> String {
    "prompt".to_string()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectConfigExportItem {
    pub path: String,
    pub config: ProjectConfig,
    pub updated_at: i64,
}
