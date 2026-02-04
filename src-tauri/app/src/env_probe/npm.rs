use crate::env_probe::ToolInfo;
use serde_json::Value;
use std::fs;
use std::path::Path;

pub fn probe_npm_packages(project_root: Option<String>) -> Vec<ToolInfo> {
    let Some(root) = project_root else {
        return Vec::new();
    };

    let path = Path::new(&root);
    let package_json_path = path.join("package.json");

    if !package_json_path.exists() {
        return Vec::new();
    }

    let Ok(content) = fs::read_to_string(&package_json_path) else {
        return Vec::new();
    };
    let Ok(json): Result<Value, _> = serde_json::from_str(&content) else {
        return Vec::new();
    };

    let mut deps = Vec::new();
    if let Some(d) = json["dependencies"].as_object() {
        deps.extend(d.keys().cloned());
    }
    if let Some(d) = json["devDependencies"].as_object() {
        deps.extend(d.keys().cloned());
    }

    if deps.is_empty() {
        return Vec::new();
    }

    let mut results = Vec::new();
    
    let node_modules = path.join("node_modules");
    if !node_modules.exists() {
        for dep in deps {
            results.push(ToolInfo {
                name: dep,
                version: "Not Installed".to_string(),
                path: None,
                description: Some("Module not found".to_string()),
            });
        }
        return results;
    }

    for dep in deps {
        let dep_pkg_path = node_modules.join(&dep).join("package.json");
        let mut installed_version = "Not Found".to_string();
        
        if dep_pkg_path.exists() {
            if let Ok(dep_content) = fs::read_to_string(&dep_pkg_path) {
                if let Ok(dep_json) = serde_json::from_str::<Value>(&dep_content) {
                    if let Some(v) = dep_json["version"].as_str() {
                        installed_version = v.to_string();
                    }
                }
            }
        }

        results.push(ToolInfo {
            name: dep,
            version: installed_version,
            path: None,
            description: None,
        });
    }

    results.sort_by(|a, b| a.name.cmp(&b.name));
    results
}