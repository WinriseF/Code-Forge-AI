use std::path::Path;
use super::ProjectType;

pub fn detect_project_type(root: &str) -> ProjectType {
    let path = Path::new(root);

    let has_tauri_dir = path.join("src-tauri").exists();
    let has_tauri_conf = path.join("src-tauri").join("tauri.conf.json").exists()
        || path.join("src-tauri").join("tauri.conf.json5").exists();

    if has_tauri_dir && has_tauri_conf {
        return ProjectType::Tauri;
    }

    let has_package_json = path.join("package.json").exists();
    let has_cargo_toml = path.join("Cargo.toml").exists();

    let has_requirements = path.join("requirements.txt").exists();
    let has_pyproject = path.join("pyproject.toml").exists();
    let has_python = has_requirements || has_pyproject;

    if has_package_json {
        if has_cargo_toml {
            return ProjectType::Mixed;
        }

        return ProjectType::NodeFrontend;
    }

    if has_cargo_toml {
        return ProjectType::Rust;
    }

    if has_python {
        return ProjectType::Python;
    }

    ProjectType::Mixed
}