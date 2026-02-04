use super::{AiContextReport, ProjectType, ToolInfo, scanners};
use crate::env_probe::traits::ProjectScanner;
use rayon::prelude::*;
use std::collections::HashMap;

pub fn scan_ai_context(root: &str) -> AiContextReport {
    let registry: Vec<(ProjectType, Box<dyn ProjectScanner>)> = vec![
        (ProjectType::NodeFrontend, Box::new(scanners::NodeScanner)),
        (ProjectType::Rust, Box::new(scanners::RustScanner)),
        (ProjectType::Java, Box::new(scanners::JavaScanner)),
        (ProjectType::Python, Box::new(scanners::PythonScanner)),
        (ProjectType::Go, Box::new(scanners::GoScanner)),
        (ProjectType::Php, Box::new(scanners::PhpScanner)),
        (ProjectType::DotNet, Box::new(scanners::DotNetScanner)),
        (ProjectType::Mobile, Box::new(scanners::MobileScanner)),
    ];

    let matched_scanners: Vec<&(ProjectType, Box<dyn ProjectScanner>)> = registry
        .par_iter()
        .filter(|(_, scanner)| scanner.match_identity(root))
        .collect();

    let results: Vec<(ProjectType, Option<ToolInfo>, HashMap<String, String>)> = matched_scanners
        .par_iter()
        .map(|(pt, scanner)| {
            let tool = scanner.detect_toolchain();
            let deps = scanner.parse_dependencies(root);
            (pt.clone(), tool, deps)
        })
        .collect();

    let mut toolchain = Vec::new();
    let mut dependencies = HashMap::new();
    let mut detected_types = Vec::new();

    for (pt, tool, deps) in results {
        detected_types.push(pt);
        if let Some(t) = tool {
            toolchain.push(t);
        }
        dependencies.extend(deps);
    }

    let project_type = determine_project_type(&detected_types, &dependencies);

    let system_info = get_system_brief();

    let summary = format!("Detected {:?} Project on {}", project_type, system_info);
    let markdown = build_markdown(&project_type, &system_info, &toolchain, &dependencies);

    AiContextReport {
        project_type,
        summary,
        system_info,
        toolchain,
        dependencies,
        markdown,
    }
}

fn determine_project_type(types: &[ProjectType], deps: &HashMap<String, String>) -> ProjectType {
    if types.is_empty() {
        return ProjectType::Mixed;
    }

    if deps.keys().any(|k: &String| k.contains("tauri") || k.starts_with("@tauri-apps")) {
        return ProjectType::Tauri;
    }

    if types.contains(&ProjectType::Mobile) {
        return ProjectType::Mobile;
    }

    if types.len() == 1 {
        return types[0].clone();
    }

    ProjectType::Mixed
}

fn get_system_brief() -> String {
    let os = sysinfo::System::name().unwrap_or("Unknown OS".to_string());
    let ver = sysinfo::System::os_version().unwrap_or_default();
    
    #[cfg(windows)]
    let shell = "PowerShell";
    #[cfg(not(windows))]
    let shell = std::env::var("SHELL").unwrap_or("Bash/Zsh".to_string());
    
    format!("{} {} ({})", os, ver, shell)
}

fn build_markdown(pt: &ProjectType, sys: &str, tools: &[ToolInfo], deps: &HashMap<String, String>) -> String {
    let mut md = String::new();
    
    md.push_str(&format!("## Context: {:?}\n", pt));
    md.push_str(&format!("- **System**: {}\n", sys));
    
    if !tools.is_empty() {
        md.push_str("- **Runtimes**: ");
        let tool_strs: Vec<String> = tools.iter()
            .map(|t| if t.version == "Not Found" { 
                format!("{}", t.name) 
            } else { 
                format!("{} {}", t.name, t.version) 
            })
            .collect();
        md.push_str(&tool_strs.join(", "));
        md.push_str("\n");
    }

    if !deps.is_empty() {
        md.push_str("\n## Key Dependencies\n");
        let mut sorted_deps: Vec<_> = deps.iter().collect();
        sorted_deps.sort_by(|a, b| a.0.cmp(b.0));
        
        for (name, ver) in sorted_deps {
            let clean_ver = ver.trim_start_matches('^').trim_start_matches('~');
            md.push_str(&format!("- {}: {}\n", name, clean_ver));
        }
    }

    md
}