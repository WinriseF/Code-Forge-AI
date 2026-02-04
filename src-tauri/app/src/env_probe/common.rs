use std::process::{Command, Stdio};
use std::time::Duration;
use regex::Regex;
use which::which;
use wait_timeout::ChildExt;

const TIMEOUT_SECS: u64 = 8;

pub fn run_command(bin: &str, args: &[&str]) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let (bin, final_args) = {
        let script_tools = ["npm", "pnpm", "yarn", "cnpm", "code", "mvn", "gradle", "pod"];

        if script_tools.contains(&bin) {
            let mut new_args = vec!["/C", bin];
            new_args.extend_from_slice(args);
            ("cmd", new_args)
        } else {
            (bin, args.to_vec())
        }
    };

    #[cfg(not(target_os = "windows"))]
    let (bin, final_args) = (bin, args);

    let mut command = Command::new(bin);
    command.args(final_args);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", bin, e))?;

    let status_code = match child.wait_timeout(Duration::from_secs(TIMEOUT_SECS)).map_err(|e| e.to_string())? {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("Time Out"));
        }
    };

    let output = child.wait_with_output().map_err(|e| e.to_string())?;

    if status_code.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout.is_empty() {
            Ok(String::from_utf8_lossy(&output.stderr).trim().to_string())
        } else {
            Ok(stdout)
        }
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

pub fn find_version(text: &str, regex: Option<&Regex>) -> String {
    let default_re = Regex::new(r"(\d+\.[\w\._-]+)").unwrap();
    let re = regex.unwrap_or(&default_re);

    if let Some(caps) = re.captures(text) {
        if let Some(match_) = caps.get(1) {
            return match_.as_str().trim().to_string();
        } else if let Some(match_) = caps.get(0) {
            return match_.as_str().trim().to_string();
        }
    }

    if text.len() < 30 && !text.contains("error") && !text.contains("Error") {
        return text.trim().to_string();
    }

    "Unknown".to_string()
}

pub fn locate_binary(bin: &str) -> Option<String> {
    match which(bin) {
        Ok(path) => Some(path.to_string_lossy().to_string()),
        Err(_) => None
    }
}

pub fn generic_probe(name: &str, bin: &str, args: &[&str], version_regex: Option<&Regex>) -> crate::env_probe::ToolInfo {
    let path = locate_binary(bin);

    let version = if let Some(_) = path {
        match run_command(bin, args) {
            Ok(out) => find_version(&out, version_regex),
            Err(e) => {
                if e.contains("Time Out") {
                    "Time Out".to_string()
                } else {
                    "Installed (Check Failed)".to_string()
                }
            },
        }
    } else {
        "Not Found".to_string()
    };

    crate::env_probe::ToolInfo {
        name: name.to_string(),
        version,
        path,
        description: None,
    }
}