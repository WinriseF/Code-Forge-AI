use crate::env_probe::{common, ToolInfo};
use rayon::prelude::*;
#[cfg(target_os = "windows")]
use std::path::Path;

#[allow(dead_code)]
struct IdeConfig {
    name: &'static str,
    bin: &'static str,
    mac_id: &'static str,
}

const IDES: &[IdeConfig] = &[
    IdeConfig { name: "VSCode", bin: "code", mac_id: "com.microsoft.VSCode" },
    IdeConfig { name: "Cursor", bin: "cursor", mac_id: "com.todesktop.230313mzl4w4u92" },
    IdeConfig { name: "Sublime Text", bin: "subl", mac_id: "com.sublimetext.4" },
    IdeConfig { name: "Xcode", bin: "xcodebuild", mac_id: "com.apple.dt.Xcode" },
    IdeConfig { name: "IntelliJ", bin: "idea", mac_id: "com.jetbrains.intellij" },
    IdeConfig { name: "Android Studio", bin: "studio", mac_id: "com.google.android.studio" },
    IdeConfig { name: "Vim", bin: "vim", mac_id: "" },
    IdeConfig { name: "NeoVim", bin: "nvim", mac_id: "" },
];

pub fn probe_ides() -> Vec<ToolInfo> {
    IDES.par_iter().map(|cfg| check_ide(cfg)).collect()
}

fn check_ide(cfg: &IdeConfig) -> ToolInfo {
    let mut info = common::generic_probe(cfg.name, cfg.bin, &["--version"], None);

    if cfg.name == "Xcode" {
        if let Ok(out) = common::run_command("xcodebuild", &["-version"]) {
            let ver = common::find_version(&out, None);
            if !ver.is_empty() {
                info.version = ver;
                info.path = common::locate_binary("xcodebuild");
            }
        }
    }

    // 2. 如果命令行没找到，且是在 macOS 上，尝试 Bundle ID 查找
    #[cfg(target_os = "macos")]
    if info.version == "Not Found" && !cfg.mac_id.is_empty() {
        if let Ok(app_path) = common::run_command("mdfind", &[&format!("kMDItemCFBundleIdentifier == '{}'", cfg.mac_id)]) {
            let first_path = app_path.lines().next().unwrap_or("").trim();
            if !first_path.is_empty() {
                info.path = Some(first_path.to_string());
                // 获取版本
                if let Ok(ver) = common::run_command("mdls", &["-name", "kMDItemShortVersionString", "-raw", first_path]) {
                     if !ver.is_empty() && ver != "(null)" {
                        info.version = ver;
                     }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    if info.version == "Not Found" {
        let search_paths = vec![
            format!(r"C:\Program Files\Microsoft VS Code\bin\{}.cmd", cfg.bin),
            format!(r"C:\Program Files\JetBrains\IntelliJ IDEA*\bin\{}64.exe", cfg.bin),
            format!(r"C:\Program Files\Android\Android Studio\bin\{}64.exe", cfg.bin),
            format!(r"C:\Program Files\Git\usr\bin\{}.exe", cfg.bin),
        ];

        for path_str in search_paths {
            if path_str.contains('*') {
                if let Some(parent) = Path::new(&path_str).parent().and_then(|p| p.parent()) {
                    let read_result = std::fs::read_dir(parent);
                    if let Ok(unflattened_entries) = read_result {
                        let entries = unflattened_entries.flatten();
                        for entry in entries {
                            let bin_path = entry.path().join("bin").join(format!("{}64.exe", cfg.bin));
                            if bin_path.exists() {
                                info.path = Some(bin_path.to_string_lossy().to_string());
                                info.version = "Installed (Version unknown)".to_string();
                                break;
                            }
                        }
                    }
                }
            } else if Path::new(&path_str).exists() {
                info.path = Some(path_str);
                info.version = "Installed".to_string();
                break;
            }
        }
    }

    info
}