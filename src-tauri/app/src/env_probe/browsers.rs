use crate::env_probe::{common, ToolInfo};
#[cfg(target_os = "windows")]
use std::path::Path;
use rayon::prelude::*;

#[cfg(target_os = "macos")]
use std::process::Command;


#[allow(dead_code)]
struct BrowserConfig {
    name: &'static str,
    mac_id: &'static str,
    linux_bin: &'static str,
    win_path_suffix: &'static str,
}

const BROWSERS: &[BrowserConfig] = &[
    BrowserConfig {
        name: "Chrome",
        mac_id: "com.google.Chrome",
        linux_bin: "google-chrome",
        win_path_suffix: r"Google\Chrome\Application\chrome.exe",
    },
    BrowserConfig {
        name: "Firefox",
        mac_id: "org.mozilla.firefox",
        linux_bin: "firefox",
        win_path_suffix: r"Mozilla Firefox\firefox.exe",
    },
    BrowserConfig {
        name: "Safari",
        mac_id: "com.apple.Safari",
        linux_bin: "",
        win_path_suffix: "",
    },
    BrowserConfig {
        name: "Edge",
        mac_id: "com.microsoft.edgemac",
        linux_bin: "microsoft-edge",
        win_path_suffix: r"Microsoft\Edge\Application\msedge.exe",
    },
    BrowserConfig {
        name: "Brave Browser",
        mac_id: "com.brave.Browser",
        linux_bin: "brave-browser",
        win_path_suffix: r"BraveSoftware\Brave-Browser\Application\brave.exe",
    },
];

pub fn probe_browsers() -> Vec<ToolInfo> {
    BROWSERS.par_iter().map(|b| check_browser(b)).collect()
}

fn check_browser(cfg: &BrowserConfig) -> ToolInfo {
    let mut version = "Not Found".to_string();
    let mut path = None;

    
    #[cfg(target_os = "macos")]
    {
        if let Ok(app_path) = common::run_command("mdfind", &[&format!("kMDItemCFBundleIdentifier == '{}'", cfg.mac_id)]) {
            if !app_path.is_empty() {
                let first_path = app_path.lines().next().unwrap_or("").trim().to_string();
                if !first_path.is_empty() {
                    path = Some(first_path.clone());
                    if let Ok(ver) = common::run_command("mdls", &["-name", "kMDItemVersion", "-raw", &first_path]) {
                        if !ver.is_empty() && ver != "(null)" {
                            version = ver;
                        }
                    }
                }
            }
        }
    }

    
    #[cfg(target_os = "linux")]
    {
        if !cfg.linux_bin.is_empty() {
            if let Some(p) = common::locate_binary(cfg.linux_bin) {
                path = Some(p);
                
                if let Ok(out) = common::run_command(cfg.linux_bin, &["--version"]) {
                    version = common::find_version(&out, None);
                }
            }
        }
    }

    
    #[cfg(target_os = "windows")]
    {
        if !cfg.win_path_suffix.is_empty() {
            
            let program_files = std::env::var("ProgramFiles").unwrap_or(r"C:\Program Files".to_string());
            let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or(r"C:\Program Files (x86)".to_string());
            
            let possible_paths = vec![
                Path::new(&program_files).join(cfg.win_path_suffix),
                Path::new(&program_files_x86).join(cfg.win_path_suffix),
            ];

            for p in possible_paths {
                if p.exists() {
                    path = p.to_str().map(|s| s.to_string());
                    if let Some(exe_path) = &path {
                        let ps_cmd = format!("(Get-Item '{}').VersionInfo.ProductVersion", exe_path);
                        if let Ok(ver) = common::run_command("powershell", &["-Command", &ps_cmd]) {
                            version = ver;
                        }
                    }
                    break;
                }
            }
        }
    }

    ToolInfo {
        name: cfg.name.to_string(),
        version,
        path,
        description: None,
    }
}