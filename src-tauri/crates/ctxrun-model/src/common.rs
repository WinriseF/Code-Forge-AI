use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct UrlHistoryItem {
    pub url: String,
    pub title: Option<String>,
    pub visit_count: i64,
    pub last_visit: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct ProjectConfig {
    pub dirs: Vec<String>,
    pub files: Vec<String>,
    pub extensions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct IgnoredSecret {
    pub id: String,
    pub value: String,
    pub rule_id: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct AppEntry {
    pub name: String,
    pub path: String,
    pub icon: Option<String>,
    pub usage_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct ShellHistoryEntry {
    pub id: i64,
    pub command: String,
    pub timestamp: i64,
    pub execution_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct ProjectConfigExportItem {
    pub path: String,
    pub config: ProjectConfig,
    pub updated_at: i64,
}
