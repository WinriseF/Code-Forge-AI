use serde::{Deserialize, Serialize};
use specta::Type;

// ============================================================================
// Data Models
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
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

#[derive(serde::Serialize, Type)]
pub struct PromptCounts {
    pub prompt: i64,
    pub command: i64,
}

// ============================================================================
// CSV Export/Import Models
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Type)]
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
