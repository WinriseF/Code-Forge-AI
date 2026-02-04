use std::collections::HashMap;
use std::path::Path;
use regex::Regex;
use once_cell::sync::Lazy;
use crate::env_probe::{ToolInfo, common::{run_command, find_version}};
use crate::env_probe::traits::{ProjectScanner, read_file_head};

static JAVA_POM_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)<artifactId>(spring-boot|spring-cloud|quarkus|micronaut|lombok|hibernate|mybatis|jakarta)[^<]*</artifactId>").unwrap());
static GRADLE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?m)(implementation|api)\s+['"](org\.springframework\.boot|io\.quarkus|io\.micronaut)[^'"]*['"]"#).unwrap());
static PYTHON_REQ_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^([a-zA-Z0-9\-_]+)[=<>]=?").unwrap());
static GO_MOD_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\s*([a-zA-Z0-9\.\-_/]+)\s+v([0-9\.]+)").unwrap());
static GO_VERSION_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"go(\d+\.\d+(\.\d+)?)").unwrap());
static PHP_COMPOSER_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?m)"(laravel/framework|symfony/[^"]+|doctrine/[^"]+|guzzlehttp/[^"]+)"\s*:\s*"([^"]+)""#).unwrap());
static DOTNET_PKG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?m)<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"#).unwrap());
static FLUTTER_DEP_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?m)^\s*(flutter|cupertino_icons|provider|bloc|get|riverpod):\s*[\^]?([0-9\.]+)"#).unwrap());

pub struct NodeScanner;
impl ProjectScanner for NodeScanner {
    fn match_identity(&self, root: &str) -> bool {
        Path::new(root).join("package.json").exists()
    }
    fn detect_toolchain(&self) -> Option<ToolInfo> {
        run_command("node", &["-v"]).ok().map(|out| ToolInfo { name: "Node".into(), version: out, path: None, description: None })
    }
    fn parse_dependencies(&self, root: &str) -> HashMap<String, String> {
        let mut d = HashMap::new();
        let path = Path::new(root).join("package.json");
        if let Ok(content) = std::fs::read_to_string(&path) {
             if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                 let whitelist = ["react", "vue", "next", "nuxt", "vite", "webpack", "typescript", "tailwindcss", "electron", "tauri", "express", "nestjs", "react-native"];
                 let mut process = |field: &str| {
                     if let Some(obj) = json[field].as_object() {
                         for (k, v) in obj {
                             if whitelist.contains(&k.as_str()) || k.starts_with("@tauri-apps") {
                                 d.insert(k.clone(), v.as_str().unwrap_or("").to_string());
                             }
                         }
                     }
                 };
                 process("dependencies");
                 process("devDependencies");
             }
        }
        d
    }
}

pub struct RustScanner;
impl ProjectScanner for RustScanner {
    fn match_identity(&self, root: &str) -> bool {
        Path::new(root).join("Cargo.toml").exists() || Path::new(root).join("src-tauri/Cargo.toml").exists()
    }
    fn detect_toolchain(&self) -> Option<ToolInfo> {
        run_command("rustc", &["--version"]).ok().map(|out| ToolInfo { name: "Rust".into(), version: find_version(&out, None), path: None, description: None })
    }
    fn parse_dependencies(&self, root: &str) -> HashMap<String, String> {
        let tauri_cargo = Path::new(root).join("src-tauri").join("Cargo.toml");
        let target = if tauri_cargo.exists() { tauri_cargo } else { Path::new(root).join("Cargo.toml") };
        let mut deps = HashMap::new();
        
        if let Some(content) = read_file_head(&target) {
            let re = Regex::new(r#"(?m)^([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{\s*version\s*=\s*"([^"]+)")"#).unwrap();
            
            let whitelist = ["tauri", "serde", "tokio", "diesel", "sqlx", "actix-web", "axum", "rocket", "reqwest", "anyhow", "thiserror"];
            
            for cap in re.captures_iter(&content) {
                let name = &cap[1];
                let ver = cap.get(2).or_else(|| cap.get(3)).map(|m| m.as_str()).unwrap_or("*");

                if whitelist.contains(&name) || name.starts_with("tauri-plugin") {
                    deps.insert(name.to_string(), ver.to_string());
                }
            }
        }
        deps
    }
}

pub struct JavaScanner;
impl ProjectScanner for JavaScanner {
    fn match_identity(&self, root: &str) -> bool {
        let p = Path::new(root);
        p.join("pom.xml").exists() || p.join("build.gradle").exists() || p.join("build.gradle.kts").exists()
    }
    fn detect_toolchain(&self) -> Option<ToolInfo> {
        run_command("java", &["-version"]).ok().map(|out| ToolInfo { name: "Java".into(), version: find_version(&out, None), path: None, description: None })
    }
    fn parse_dependencies(&self, root: &str) -> HashMap<String, String> {
        let mut deps = HashMap::new();
        let p = Path::new(root);
        if let Some(content) = read_file_head(&p.join("pom.xml")) {
            for cap in JAVA_POM_RE.captures_iter(&content) {
                deps.insert(cap[1].to_string(), "Detected".into());
            }
        }
        if let Some(content) = read_file_head(&p.join("build.gradle")).or_else(|| read_file_head(&p.join("build.gradle.kts"))) {
            for cap in GRADLE_RE.captures_iter(&content) {
                let full_name = &cap[2];
                let simple_name = full_name.split('.').last().unwrap_or(full_name);
                deps.insert(simple_name.to_string(), "Detected".into());
            }
        }
        deps
    }
}

const PYTHON_BINS: &[&str] = &["python3", "python", "py"];
pub struct PythonScanner;
impl ProjectScanner for PythonScanner {
    fn match_identity(&self, root: &str) -> bool {
        let p = Path::new(root);
        p.join("requirements.txt").exists() || p.join("pyproject.toml").exists() || p.join("Pipfile").exists()
    }
    fn detect_toolchain(&self) -> Option<ToolInfo> {
        for bin in PYTHON_BINS {
            if let Ok(out) = run_command(bin, &["--version"]) {
                return Some(ToolInfo {
                    name: "Python".into(),
                    version: find_version(&out, None),
                    path: None,
                    description: None,
                });
            }
        }
        None
    }
    fn parse_dependencies(&self, root: &str) -> HashMap<String, String> {
        let mut deps = HashMap::new();
        if let Some(content) = read_file_head(&Path::new(root).join("requirements.txt")) {
            let whitelist = ["django", "flask", "fastapi", "pandas", "numpy", "scipy", "torch", "tensorflow", "scikit-learn", "requests", "sqlalchemy"];
            for cap in PYTHON_REQ_RE.captures_iter(&content) {
                let name = &cap[1];
                if whitelist.contains(&name.to_lowercase().as_str()) {
                    deps.insert(name.to_string(), "pip".into());
                }
            }
        }
        deps
    }
}

pub struct GoScanner;
impl ProjectScanner for GoScanner {
    fn match_identity(&self, root: &str) -> bool {
        Path::new(root).join("go.mod").exists()
    }
    fn detect_toolchain(&self) -> Option<ToolInfo> {
        run_command("go", &["version"]).ok().map(|out| ToolInfo {
            name: "Go".into(),
            version: find_version(&out, Some(&GO_VERSION_RE)), 
            path: None,
            description: None,
        })
    }
    fn parse_dependencies(&self, root: &str) -> HashMap<String, String> {
        let mut deps = HashMap::new();
        if let Some(content) = read_file_head(&Path::new(root).join("go.mod")) {
            let whitelist = ["gin", "echo", "fiber", "gorm", "sqlx", "cobra", "viper", "protobuf", "grpc"];
            for cap in GO_MOD_RE.captures_iter(&content) {
                let name = cap[1].split('/').last().unwrap_or(&cap[1]);
                if whitelist.contains(&name) {
                    deps.insert(name.to_string(), cap[2].to_string());
                }
            }
        }
        deps
    }
}

pub struct PhpScanner;
impl ProjectScanner for PhpScanner {
    fn match_identity(&self, root: &str) -> bool {
        Path::new(root).join("composer.json").exists()
    }
    fn detect_toolchain(&self) -> Option<ToolInfo> {
        run_command("php", &["-v"]).ok().map(|out| ToolInfo { name: "PHP".into(), version: find_version(&out, None), path: None, description: None })
    }
    fn parse_dependencies(&self, root: &str) -> HashMap<String, String> {
        let mut deps = HashMap::new();
        if let Some(content) = read_file_head(&Path::new(root).join("composer.json")) {
            for cap in PHP_COMPOSER_RE.captures_iter(&content) {
                deps.insert(cap[1].to_string(), cap[2].to_string());
            }
        }
        deps
    }
}

pub struct DotNetScanner;
impl ProjectScanner for DotNetScanner {
    fn match_identity(&self, root: &str) -> bool {
        let p = Path::new(root);
        if let Ok(entries) = std::fs::read_dir(p) {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if name.ends_with(".csproj") || name.ends_with(".sln") {
                        return true;
                    }
                }
            }
        }
        false
    }
    fn detect_toolchain(&self) -> Option<ToolInfo> {
        run_command("dotnet", &["--version"]).ok().map(|out| ToolInfo { name: ".NET SDK".into(), version: out, path: None, description: None })
    }
    fn parse_dependencies(&self, root: &str) -> HashMap<String, String> {
        let mut deps = HashMap::new();
        let p = Path::new(root);
        if let Ok(entries) = std::fs::read_dir(p) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".csproj") {
                    if let Some(content) = read_file_head(&entry.path()) {
                        let whitelist = ["Microsoft.AspNetCore", "Microsoft.EntityFrameworkCore", "Dapper", "Newtonsoft.Json"];
                        for cap in DOTNET_PKG_RE.captures_iter(&content) {
                            let pkg_name = &cap[1];
                            if whitelist.iter().any(|w| pkg_name.starts_with(w)) {
                                deps.insert(pkg_name.to_string(), cap[2].to_string());
                            }
                        }
                    }
                    break;
                }
            }
        }
        deps
    }
}

pub struct MobileScanner;
impl ProjectScanner for MobileScanner {
    fn match_identity(&self, root: &str) -> bool {
        Path::new(root).join("pubspec.yaml").exists()
    }
    fn detect_toolchain(&self) -> Option<ToolInfo> {
        run_command("flutter", &["--version"]).ok().map(|out| ToolInfo { name: "Flutter".into(), version: find_version(&out, None), path: None, description: None })
    }
    fn parse_dependencies(&self, root: &str) -> HashMap<String, String> {
        let mut deps = HashMap::new();
        if let Some(content) = read_file_head(&Path::new(root).join("pubspec.yaml")) {
            for cap in FLUTTER_DEP_RE.captures_iter(&content) {
                deps.insert(cap[1].to_string(), cap[2].to_string());
            }
        }
        deps
    }
}