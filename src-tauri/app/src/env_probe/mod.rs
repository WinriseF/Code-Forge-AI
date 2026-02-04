use serde::Serialize;
use std::collections::HashMap;

pub mod common;
pub mod system;
pub mod binaries;
pub mod browsers;
pub mod ides;
pub mod npm;
pub mod sdks;
pub mod scan_logic;
pub mod traits;
pub mod scanners;

/// 工具的详细信息
#[derive(Debug, Serialize, Clone)]
pub struct ToolInfo {
    pub name: String,
    pub version: String,
    pub path: Option<String>,
    pub description: Option<String>,
}

/// 环境报告的顶级分类
#[derive(Debug, Serialize, Clone)]
pub struct EnvReport {
    pub system: Option<HashMap<String, String>>,
    pub binaries: Vec<ToolInfo>,
    pub browsers: Vec<ToolInfo>,
    pub ides: Vec<ToolInfo>,
    pub languages: Vec<ToolInfo>,
    pub sdks: HashMap<String, Vec<String>>,
    pub virtualization: Vec<ToolInfo>,
    pub databases: Vec<ToolInfo>,
    pub managers: Vec<ToolInfo>,
    pub utilities: Vec<ToolInfo>,
    pub npm_packages: Vec<ToolInfo>,
}

impl Default for EnvReport {
    fn default() -> Self {
        Self {
            system: None,
            binaries: Vec::new(),
            browsers: Vec::new(),
            ides: Vec::new(),
            languages: Vec::new(),
            sdks: HashMap::new(),
            virtualization: Vec::new(),
            databases: Vec::new(),
            managers: Vec::new(),
            utilities: Vec::new(),
            npm_packages: Vec::new(),
        }
    }
}

/// 项目特征类型定义
#[derive(Debug, Serialize, Clone, PartialEq)]
pub enum ProjectType {
    Tauri,        // 前端 + Rust
    NodeFrontend, // React, Vue...
    Rust,         // Pure Rust
    Python,       // Django, Flask
    Java,         // Spring Boot
    Go,           // Gin
    Php,          // Laravel
    DotNet,       // ASP.NET Core, C#
    Mobile,       // Flutter, React Native
    Mixed,        // 混合
}

/// AI 上下文扫描结果
#[derive(Debug, Serialize, Clone)]
pub struct AiContextReport {
    pub project_type: ProjectType,
    pub summary: String,
    pub system_info: String,
    pub toolchain: Vec<ToolInfo>,
    pub dependencies: HashMap<String, String>,
    pub markdown: String,
}