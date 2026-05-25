use std::{
    path::{Component, Path, PathBuf},
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

use ctxrun_process_utils::new_background_command;
use regex::Regex;
use serde::Deserialize;

use crate::models::ExecRiskLevel;
use crate::utils::encode_utf16_base64;

const POWERSHELL_PARSER_SCRIPT: &str = include_str!("powershell_parser.ps1");
const POWERSHELL_PARSE_TIMEOUT_MS: u64 = 1_500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SafetyDecision {
    SafeAuto,
    ApprovalRequired,
    Blocked,
}

#[derive(Debug, Clone)]
pub struct SafetyAssessment {
    pub decision: SafetyDecision,
    pub reason: String,
    pub risk: ExecRiskLevel,
    pub workdir: PathBuf,
    pub parsed_commands: Vec<Vec<String>>,
    pub prefix_rule: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PowershellParseStatus {
    Ok,
    Unsupported,
    ParseErrors,
    ParseFailed,
}

#[derive(Debug, Clone)]
struct PowershellParseResult {
    status: PowershellParseStatus,
    commands: Vec<Vec<String>>,
}

#[derive(Debug, Clone)]
struct SafetyScope {
    root: PathBuf,
    workdir: PathBuf,
}

#[derive(Debug, thiserror::Error)]
pub enum SafetyError {
    #[error("workspaceRoot is required.")]
    MissingWorkspaceRoot,
    #[error("command is required.")]
    MissingCommand,
    #[error("workspace root does not exist: {0}")]
    MissingWorkspace(String),
    #[error("working directory does not exist: {0}")]
    MissingWorkdir(String),
    #[error("working directory must stay inside the workspace root.")]
    WorkdirOutsideWorkspace,
}

pub fn assess_command(
    command: &str,
    workspace_root: &str,
    workdir: Option<&str>,
) -> Result<SafetyAssessment, SafetyError> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err(SafetyError::MissingCommand);
    }
    let scope = resolve_scope(workspace_root, workdir)?;

    if let Some(simple_words) = try_parse_simple_command_words(trimmed) {
        return Ok(assess_parsed_commands(
            vec![simple_words],
            &scope,
            "Simple read-only command matched the auto-allowed safelist.",
        ));
    }

    if looks_blocked_raw(trimmed) {
        return Ok(blocked_assessment(
            "Blocked because the command includes a dangerous process or shell launcher.",
            scope.workdir,
            Vec::new(),
        ));
    }

    let parse_result = parse_powershell_script(trimmed);
    let parsed_commands = parse_result.commands.clone();
    if parsed_commands.is_empty() {
        let (reason, risk) = match parse_result.status {
            PowershellParseStatus::ParseErrors => (
                "PowerShell parser reported syntax issues, so explicit approval is required.".to_string(),
                ExecRiskLevel::High,
            ),
            PowershellParseStatus::Unsupported => (
                "Command uses PowerShell features the auto-approver cannot fully analyze, so explicit approval is required.".to_string(),
                ExecRiskLevel::Medium,
            ),
            PowershellParseStatus::ParseFailed | PowershellParseStatus::Ok => (
                "PowerShell parser could not classify this command safely, so explicit approval is required.".to_string(),
                ExecRiskLevel::High,
            ),
        };

        return Ok(SafetyAssessment {
            decision: SafetyDecision::ApprovalRequired,
            reason,
            risk,
            workdir: scope.workdir,
            parsed_commands,
            prefix_rule: None,
        });
    }

    Ok(assess_parsed_commands(
        parsed_commands,
        &scope,
        "Read-only command is in the auto-allowed safelist.",
    ))
}

fn assess_parsed_commands(
    parsed_commands: Vec<Vec<String>>,
    scope: &SafetyScope,
    safe_reason: &str,
) -> SafetyAssessment {
    if parsed_commands.iter().any(|words| is_blocked_command(words)) {
        return blocked_assessment(
            "Blocked because the command maps to a dangerous cmdlet or shell launcher.",
            scope.workdir.clone(),
            parsed_commands,
        );
    }

    if parsed_commands
        .iter()
        .all(|words| is_safe_read_only_command(words, scope))
    {
        return SafetyAssessment {
            decision: SafetyDecision::SafeAuto,
            reason: safe_reason.to_string(),
            risk: ExecRiskLevel::Low,
            workdir: scope.workdir.clone(),
            prefix_rule: None,
            parsed_commands,
        };
    }

    SafetyAssessment {
        decision: SafetyDecision::ApprovalRequired,
        reason: "Command is not in the read-only safelist and requires explicit approval."
            .to_string(),
        risk: ExecRiskLevel::Medium,
        prefix_rule: suggested_prefix_rule(&parsed_commands),
        workdir: scope.workdir.clone(),
        parsed_commands,
    }
}

fn blocked_assessment(
    reason: &str,
    workdir: PathBuf,
    parsed_commands: Vec<Vec<String>>,
) -> SafetyAssessment {
    SafetyAssessment {
        decision: SafetyDecision::Blocked,
        reason: reason.to_string(),
        risk: ExecRiskLevel::High,
        workdir,
        parsed_commands,
        prefix_rule: None,
    }
}

fn resolve_scope(workspace_root: &str, workdir: Option<&str>) -> Result<SafetyScope, SafetyError> {
    let workspace_root = workspace_root.trim();
    if workspace_root.is_empty() {
        return Err(SafetyError::MissingWorkspaceRoot);
    }
    let root = std::fs::canonicalize(workspace_root)
        .map_err(|_| SafetyError::MissingWorkspace(workspace_root.to_string()))?;

    let target = match workdir.map(str::trim).filter(|value| !value.is_empty()) {
        Some(relative) => root.join(relative),
        None => root.clone(),
    };

    let canonical = std::fs::canonicalize(&target)
        .map_err(|_| SafetyError::MissingWorkdir(target.display().to_string()))?;

    if !path_is_within_workspace(&canonical, &root) {
        return Err(SafetyError::WorkdirOutsideWorkspace);
    }

    Ok(SafetyScope {
        root,
        workdir: canonical,
    })
}

fn path_is_within_workspace(path: &Path, root: &Path) -> bool {
    let candidate = normalized_path_components(path);
    let workspace = normalized_path_components(root);
    candidate.len() >= workspace.len()
        && candidate
            .iter()
            .zip(workspace.iter())
            .all(|(candidate, workspace)| candidate == workspace)
}

fn normalized_path_components(path: &Path) -> Vec<String> {
    normalize_path_for_comparison(path)
        .components()
        .map(|component| {
            let component = component.as_os_str().to_string_lossy();
            #[cfg(target_os = "windows")]
            {
                component.to_ascii_lowercase()
            }
            #[cfg(not(target_os = "windows"))]
            {
                component.to_string()
            }
        })
        .collect()
}

fn normalize_path_for_comparison(path: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let raw = path.to_string_lossy();
        if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{}", rest));
        }
        if let Some(rest) = raw.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
        PathBuf::from(raw.into_owned())
    }

    #[cfg(not(target_os = "windows"))]
    {
        path.to_path_buf()
    }
}

fn looks_blocked_raw(command: &str) -> bool {
    static BLOCKED_PATTERN: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();

    let blocked = BLOCKED_PATTERN.get_or_init(|| {
        Regex::new(
            r"(?i)(^|[^a-z0-9_])(?:start-process|stop-process|invoke-item|ii|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?|bash(?:\.exe)?|sh(?:\.exe)?|wsl(?:\.exe)?)(?:$|[^a-z0-9_])",
        )
        .expect("valid blocked regex")
    });
    blocked.is_match(command)
}

fn parse_powershell_script(script: &str) -> PowershellParseResult {
    let encoded_script = encode_utf16_base64(script);
    let encoded_parser_script = encode_utf16_base64(POWERSHELL_PARSER_SCRIPT);

    let mut command = new_background_command("powershell.exe");
    command.args([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        &encoded_parser_script,
    ]);
    command.env("CTXRUN_POWERSHELL_PAYLOAD", encoded_script);

    let output = match command_output_with_timeout(
        command,
        Duration::from_millis(POWERSHELL_PARSE_TIMEOUT_MS),
    ) {
        Ok(Some(output)) => output,
        Ok(None) => {
            return PowershellParseResult {
                status: PowershellParseStatus::ParseFailed,
                commands: Vec::new(),
            };
        }
        Err(_) => {
            return PowershellParseResult {
                status: PowershellParseStatus::ParseFailed,
                commands: Vec::new(),
            };
        }
    };

    if !output.status.success() {
        return PowershellParseResult {
            status: PowershellParseStatus::ParseFailed,
            commands: Vec::new(),
        };
    }

    let parsed = match serde_json::from_slice::<PowershellParserOutput>(&output.stdout) {
        Ok(parsed) => parsed,
        Err(_) => {
            return PowershellParseResult {
                status: PowershellParseStatus::ParseFailed,
                commands: Vec::new(),
            };
        }
    };

    match parsed.status.as_str() {
        "ok" => PowershellParseResult {
            status: PowershellParseStatus::Ok,
            commands: parsed.commands.unwrap_or_default(),
        },
        "unsupported" => PowershellParseResult {
            status: PowershellParseStatus::Unsupported,
            commands: Vec::new(),
        },
        "parse_errors" => PowershellParseResult {
            status: PowershellParseStatus::ParseErrors,
            commands: Vec::new(),
        },
        _ => PowershellParseResult {
            status: PowershellParseStatus::ParseFailed,
            commands: Vec::new(),
        },
    }
}

fn command_output_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> std::io::Result<Option<Output>> {
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = command.spawn()?;
    let started_at = Instant::now();

    loop {
        if child.try_wait()?.is_some() {
            return child.wait_with_output().map(Some);
        }

        if started_at.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(None);
        }

        thread::sleep(Duration::from_millis(10));
    }
}

fn try_parse_simple_command_words(script: &str) -> Option<Vec<String>> {
    if script.chars().any(|ch| {
        matches!(
            ch,
            '|' | ';' | '&' | '>' | '<' | '$' | '`' | '(' | ')' | '{' | '}' | '[' | ']'
        )
    }) {
        return None;
    }

    let mut words = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;

    for ch in script.chars() {
        match quote {
            Some(active_quote) => {
                if ch == active_quote {
                    quote = None;
                } else {
                    current.push(ch);
                }
            }
            None => match ch {
                '\'' | '"' => {
                    quote = Some(ch);
                }
                ch if ch.is_whitespace() => {
                    if !current.is_empty() {
                        words.push(std::mem::take(&mut current));
                    }
                }
                _ => current.push(ch),
            },
        }
    }

    if quote.is_some() {
        return None;
    }

    if !current.is_empty() {
        words.push(current);
    }

    if words.is_empty() { None } else { Some(words) }
}

fn is_safe_read_only_command(words: &[String], scope: &SafetyScope) -> bool {
    if words.is_empty() {
        return false;
    }

    let command = normalize_name(&words[0]);
    match command.as_str() {
        "echo" | "write-output" | "write-host" => true,
        "dir" | "ls" | "get-childitem" | "gci" => is_safe_path_command(words, scope),
        "cat" | "type" | "gc" | "get-content" => is_safe_path_command(words, scope),
        "select-string" | "sls" => is_safe_select_string(words, scope),
        "findstr" => is_safe_findstr(words, scope),
        "measure-object" | "measure" => true,
        "get-location" | "gl" | "pwd" => true,
        "test-path" | "tp" => is_safe_path_command(words, scope),
        "resolve-path" | "rvpa" => is_safe_path_command(words, scope),
        "select-object" | "select" => true,
        "get-item" => is_safe_path_command(words, scope),
        "get-date" | "date" => true,
        "hostname" | "whoami" => true,
        "git" => is_safe_git_command(words),
        "rg" => is_safe_ripgrep(words, scope),
        _ => false,
    }
}

fn is_safe_git_command(words: &[String]) -> bool {
    let mut iter = words.iter().skip(1);
    while let Some(arg) = iter.next() {
        let arg_lc = arg.to_ascii_lowercase();
        if arg.starts_with('-') {
            if matches!(
                arg_lc.as_str(),
                "-c" | "--config" | "--git-dir" | "--work-tree"
            ) {
                return false;
            }
            continue;
        }

        return matches!(
            arg_lc.as_str(),
            "status" | "log" | "show" | "diff" | "cat-file" | "branch"
        ) && git_tail_is_read_only(iter.cloned().collect());
    }

    false
}

fn git_tail_is_read_only(args: Vec<String>) -> bool {
    if args.is_empty() {
        return true;
    }

    let mut saw_branch_query = false;
    for arg in &args {
        let lower = arg.to_ascii_lowercase();
        match lower.as_str() {
            "--" | "-c" | "--config" | "--git-dir" | "--work-tree" | "-o" => return false,
            "--list" | "-l" | "--show-current" | "-a" | "--all" | "-r" | "--remotes" | "-v"
            | "-vv" | "--verbose" => {
                saw_branch_query = true;
            }
            _ if lower.starts_with("--output") => return false,
            _ if lower.starts_with("--format=") => {
                saw_branch_query = true;
            }
            _ if lower.starts_with('-') => {}
            _ => return false,
        }
    }

    saw_branch_query
}

fn is_safe_ripgrep(words: &[String], scope: &SafetyScope) -> bool {
    if words.iter().skip(1).any(|arg| {
        let arg_lc = arg.to_ascii_lowercase();
        matches!(arg_lc.as_str(), "--search-zip" | "-z")
            || arg_lc == "--pre"
            || arg_lc.starts_with("--pre=")
            || arg_lc == "--hostname-bin"
            || arg_lc.starts_with("--hostname-bin=")
            || arg_lc == "-g"
            || arg_lc == "--glob"
            || arg_lc.starts_with("--glob=")
    }) {
        return false;
    }

    let mut paths = Vec::new();
    let mut saw_pattern = false;
    let mut path_only_mode = false;
    let mut iter = words.iter().skip(1).peekable();

    while let Some(arg) = iter.next() {
        let lower = arg.to_ascii_lowercase();
        if lower == "--" {
            return false;
        }

        if lower == "--files" {
            path_only_mode = true;
            continue;
        }

        if lower == "-e" || lower == "--regexp" {
            if iter.next().is_none() {
                return false;
            }
            saw_pattern = true;
            continue;
        }

        if lower.starts_with('-') {
            continue;
        }

        if path_only_mode || saw_pattern {
            paths.push(arg.clone());
        } else {
            saw_pattern = true;
        }
    }

    paths_are_safe(&paths, scope)
}

fn is_safe_path_command(words: &[String], scope: &SafetyScope) -> bool {
    let Some(paths) = collect_path_args(words, PositionalPathMode::All) else {
        return false;
    };
    paths_are_safe(&paths, scope)
}

fn is_safe_select_string(words: &[String], scope: &SafetyScope) -> bool {
    let Some(paths) = collect_path_args(words, PositionalPathMode::AfterFirst) else {
        return false;
    };
    paths_are_safe(&paths, scope)
}

fn is_safe_findstr(words: &[String], scope: &SafetyScope) -> bool {
    let mut paths = Vec::new();
    let mut saw_pattern = false;

    for arg in words.iter().skip(1) {
        if arg.starts_with('/') {
            continue;
        }

        if saw_pattern {
            paths.push(arg.clone());
        } else {
            saw_pattern = true;
        }
    }

    paths_are_safe(&paths, scope)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PositionalPathMode {
    All,
    AfterFirst,
}

fn collect_path_args(words: &[String], positional_mode: PositionalPathMode) -> Option<Vec<String>> {
    let mut paths = Vec::new();
    let mut positional_count = 0usize;
    let mut iter = words.iter().skip(1).peekable();

    while let Some(arg) = iter.next() {
        if arg == "--" {
            return None;
        }

        if let Some(value) = inline_path_option_value(arg) {
            paths.push(value);
            continue;
        }

        if is_path_option(arg) {
            let value = iter.next()?;
            paths.push(value.clone());
            continue;
        }

        if arg.starts_with('-') {
            continue;
        }

        match positional_mode {
            PositionalPathMode::All => paths.push(arg.clone()),
            PositionalPathMode::AfterFirst => {
                if positional_count > 0 {
                    paths.push(arg.clone());
                }
                positional_count += 1;
            }
        }
    }

    Some(paths)
}

fn inline_path_option_value(arg: &str) -> Option<String> {
    let trimmed = arg.trim();
    if !trimmed.starts_with('-') {
        return None;
    }

    for separator in ['=', ':'] {
        let Some((name, value)) = trimmed.split_once(separator) else {
            continue;
        };
        if is_path_option_name(name) && !value.trim().is_empty() {
            return Some(value.trim().to_string());
        }
    }

    None
}

fn is_path_option(arg: &str) -> bool {
    is_path_option_name(arg)
}

fn is_path_option_name(arg: &str) -> bool {
    let name = arg
        .trim_start_matches('-')
        .split(['=', ':'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(name.as_str(), "path" | "literalpath" | "pspath")
}

fn paths_are_safe(paths: &[String], scope: &SafetyScope) -> bool {
    paths
        .iter()
        .all(|path| is_safe_workspace_path_arg(path, scope))
}

fn is_safe_workspace_path_arg(raw: &str, scope: &SafetyScope) -> bool {
    let value = raw.trim();
    if value.is_empty() {
        return false;
    }

    if value.starts_with('~')
        || value.contains('$')
        || value.contains('%')
        || value.contains('`')
        || value.contains('*')
        || value.contains('?')
        || value.contains('[')
        || value.contains(']')
    {
        return false;
    }

    let path = Path::new(value);
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return false;
    }

    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        scope.workdir.join(path)
    };

    let Some(normalized) = lexically_normalize_path(&candidate) else {
        return false;
    };

    path_is_within_workspace(&normalized, &scope.root)
}

fn lexically_normalize_path(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::Normal(segment) => normalized.push(segment),
            Component::ParentDir => return None,
        }
    }

    Some(normalized)
}

fn is_blocked_command(words: &[String]) -> bool {
    if words.is_empty() {
        return true;
    }

    let command = normalize_name(&words[0]);
    if matches!(
        command.as_str(),
        "start-process"
            | "stop-process"
            | "invoke-item"
            | "ii"
            | "cmd"
            | "powershell"
            | "pwsh"
            | "bash"
            | "sh"
            | "wsl"
    ) {
        return true;
    }

    command == "git" && is_blocked_git_command(words)
}

fn is_blocked_git_command(words: &[String]) -> bool {
    let mut iter = words.iter().skip(1);
    while let Some(arg) = iter.next() {
        let arg_lc = arg.to_ascii_lowercase();
        if arg.starts_with('-') {
            if matches!(
                arg_lc.as_str(),
                "-c" | "--config" | "--git-dir" | "--work-tree"
            ) {
                let _ = iter.next();
            }
            continue;
        }

        return matches!(
            arg_lc.as_str(),
            "reset" | "clean" | "checkout" | "switch" | "restore"
        );
    }

    false
}

fn suggested_prefix_rule(parsed_commands: &[Vec<String>]) -> Option<Vec<String>> {
    let first = parsed_commands.first()?;
    let command = normalize_name(first.first()?);
    match command.as_str() {
        "cargo" | "git" | "python" | "python3" | "pytest" | "npm" | "pnpm" | "yarn" => {
            Some(first.iter().take(2).cloned().collect())
        }
        _ => Some(first.iter().take(1).cloned().collect()),
    }
}

fn normalize_name(value: &str) -> String {
    let trimmed = value
        .trim()
        .trim_matches(|ch| ch == '(' || ch == ')')
        .trim_matches(|ch| ch == '"' || ch == '\'')
        .trim_start_matches('-');
    let file_name = trimmed
        .rsplit(['/', '\\'])
        .find(|segment| !segment.is_empty())
        .unwrap_or(trimmed);
    let lower = file_name.to_ascii_lowercase();
    lower
        .strip_suffix(".exe")
        .unwrap_or(lower.as_str())
        .to_string()
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::ErrorKind,
        path::PathBuf,
        time::{Duration, Instant},
    };

    use ctxrun_process_utils::new_background_command;

    use super::{SafetyDecision, assess_command, command_output_with_timeout};

    struct TestWorkspace {
        root: PathBuf,
    }

    impl TestWorkspace {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "ctxrun-exec-runtime-safety-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(&root).expect("create temp workspace");
            Self { root }
        }

        fn root_str(&self) -> String {
            self.root.display().to_string()
        }

        fn write_file(&self, relative: &str, content: &str) {
            let path = self.root.join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("create parent directory");
            }
            fs::write(path, content).expect("write test file");
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn set_content_requires_approval_instead_of_blocking() {
        let workspace = TestWorkspace::new();
        let assessment = assess_command("Set-Content notes.txt hello", &workspace.root_str(), None)
            .expect("assess command");

        assert_eq!(assessment.decision, SafetyDecision::ApprovalRequired);
    }

    #[test]
    fn new_item_requires_approval_instead_of_blocking() {
        let workspace = TestWorkspace::new();
        let assessment = assess_command("New-Item notes.txt", &workspace.root_str(), None)
            .expect("assess command");

        assert_eq!(assessment.decision, SafetyDecision::ApprovalRequired);
    }

    #[test]
    fn redirection_requires_approval_instead_of_blocking() {
        let workspace = TestWorkspace::new();
        let assessment = assess_command("\"hello\" > notes.txt", &workspace.root_str(), None)
            .expect("assess command");

        assert_eq!(assessment.decision, SafetyDecision::ApprovalRequired);
    }

    #[test]
    fn start_process_stays_blocked() {
        let workspace = TestWorkspace::new();
        let assessment = assess_command("Start-Process notepad", &workspace.root_str(), None)
            .expect("assess command");

        assert_eq!(assessment.decision, SafetyDecision::Blocked);
    }

    #[test]
    fn shell_launchers_are_blocked_after_normalization() {
        let workspace = TestWorkspace::new();
        for command in [
            "cmd.exe /C dir",
            "powershell.exe -NoProfile",
            "pwsh -NoProfile",
            "bash.exe -lc ls",
            "./bash -c ls",
            "'bash' -c ls",
            "wsl ls",
        ] {
            let assessment =
                assess_command(command, &workspace.root_str(), None).expect("assess command");
            assert_eq!(
                assessment.decision,
                SafetyDecision::Blocked,
                "{command} should be blocked"
            );
        }
    }

    #[test]
    fn read_only_file_commands_reject_workspace_escape_paths() {
        let workspace = TestWorkspace::new();
        let outside = std::env::temp_dir().join(format!(
            "ctxrun-exec-runtime-outside-{}",
            uuid::Uuid::new_v4()
        ));
        fs::write(&outside, "outside").expect("write outside file");

        let cases = [
            "Get-Content ../secret.txt".to_string(),
            format!("Get-Content {}", outside.display()),
            "rg needle ..".to_string(),
            "git show HEAD:../../secret.txt".to_string(),
        ];

        for command in cases {
            let assessment =
                assess_command(&command, &workspace.root_str(), None).expect("assess command");
            assert_ne!(
                assessment.decision,
                SafetyDecision::SafeAuto,
                "{command} should not be auto-approved"
            );
        }

        let _ = fs::remove_file(outside);
    }

    #[test]
    fn read_only_file_commands_allow_workspace_local_paths() {
        let workspace = TestWorkspace::new();
        workspace.write_file("src/file.txt", "hello");

        for command in ["Get-Content src/file.txt", "rg hello src"] {
            let assessment =
                assess_command(command, &workspace.root_str(), None).expect("assess command");
            assert_eq!(
                assessment.decision,
                SafetyDecision::SafeAuto,
                "{command} should be auto-approved"
            );
        }
    }

    #[test]
    fn powershell_parser_command_timeout_returns_none() {
        let mut command = new_background_command("powershell.exe");
        command.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Sleep -Seconds 5",
        ]);

        let started = Instant::now();
        match command_output_with_timeout(command, Duration::from_millis(100)) {
            Ok(None) => {
                assert!(
                    started.elapsed() < Duration::from_secs(2),
                    "timeout helper should return promptly"
                );
            }
            Ok(Some(_)) => panic!("expected sleeping PowerShell command to time out"),
            Err(err) if err.kind() == ErrorKind::NotFound => {}
            Err(err) => panic!("unexpected timeout helper error: {err}"),
        }
    }
}

#[derive(Debug, Deserialize)]
struct PowershellParserOutput {
    status: String,
    commands: Option<Vec<Vec<String>>>,
}
