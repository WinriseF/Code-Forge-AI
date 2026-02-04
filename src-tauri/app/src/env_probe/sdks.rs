use std::collections::HashMap;

#[cfg(target_os = "macos")]
use crate::env_probe::common;

pub fn probe_sdks() -> HashMap<String, Vec<String>> {
    let mut sdks = HashMap::new();

    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = common::run_command("xcodebuild", &["-showsdks"]) {
            let mut ios_sdks = Vec::new();
            for line in out.lines() {
                if line.contains("-sdk iphoneos") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        ios_sdks.push(format!("{} {}", parts[0], parts[1]));
                    }
                }
            }
            if !ios_sdks.is_empty() {
                sdks.insert("iOS SDK".to_string(), ios_sdks);
            }
        }
    }

    let android_home = std::env::var("ANDROID_HOME").or_else(|_| std::env::var("ANDROID_SDK_ROOT"));

    if let Ok(root) = android_home {
        let mut android_info = Vec::new();
        let build_tools = std::path::Path::new(&root).join("build-tools");
        if build_tools.exists() {
            if let Ok(entries) = std::fs::read_dir(build_tools) {
                let mut versions: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .filter(|n| n.chars().next().map_or(false, |c| c.is_numeric()))
                    .collect();
                versions.sort();
                if !versions.is_empty() {
                    android_info.push(format!("Build Tools: {}", versions.join(", ")));
                }
            }
        }

        let platforms = std::path::Path::new(&root).join("platforms");
        if platforms.exists() {
             if let Ok(entries) = std::fs::read_dir(platforms) {
                let mut levels: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .filter(|n| n.starts_with("android-"))
                    .map(|n| n.replace("android-", ""))
                    .collect();
                // 数字排序
                levels.sort_by(|a, b| a.parse::<u32>().unwrap_or(0).cmp(&b.parse::<u32>().unwrap_or(0)));
                if !levels.is_empty() {
                    android_info.push(format!("API Levels: {}", levels.join(", ")));
                }
             }
        }

        if !android_info.is_empty() {
            sdks.insert("Android SDK".to_string(), android_info);
        }
    }

    sdks
}