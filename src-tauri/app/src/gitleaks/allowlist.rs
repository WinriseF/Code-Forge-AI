use regex::Regex;
use once_cell::sync::Lazy;

static ALLOW_REGEXES: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r"(?i)^true|false|null$").unwrap(),
        Regex::new(r"(?i)^([a-z*\\.])+$").unwrap(),
        Regex::new(r"^\$(?:\d+|\{\d+\})$").unwrap(),
        Regex::new(r"^\$(?:[A-Z_]+|[a-z_]+)$").unwrap(),
        Regex::new(r"^\$\{(?:[A-Z_]+|[a-z_]+)\}$").unwrap(),
        Regex::new(r"^\{\{[ \t]*[\w ().|]+[ \t]*\}\}$").unwrap(),
        Regex::new(r#"^\$\{\{[ \t]*(?:env|github|secrets|vars)(?:\.[A-Za-z]\w+)+[\w "'&./=|]*[ \t]*\}\}$"#).unwrap(),
        Regex::new(r"^%(?:[A-Z_]+|[a-z_]+)%$").unwrap(),
        Regex::new(r"^%[+\-# 0]?[bcdeEfFgGoOpqstTUvxX]$").unwrap(),
        Regex::new(r"^\{\d{0,2}\}$").unwrap(),
        Regex::new(r"^@(?:[A-Z_]+|[a-z_]+)@$").unwrap(),
        Regex::new(r"^/Users/(?i)[a-z0-9]+/[\w .-/]+$").unwrap(),
        Regex::new(r"^/(?:bin|etc|home|opt|tmp|usr|var)/[\w ./-]+$").unwrap(),
        Regex::new(r"(?i)^#(?:[0-9a-f]{3}|[0-9a-f]{6})$").unwrap(),
    ]
});

// 判断是否为UUID (形如 xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
fn is_uuid(val: &str) -> bool {
    if val.len() != 36 { return false; }
    let hyphens = val.chars().filter(|c| *c == '-').count();
    if hyphens != 4 { return false; }
    val.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

// 判断是否为 Git SHA (40位 hex)
fn is_git_sha(val: &str) -> bool {
    if val.len() != 40 { return false; }
    val.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn is_safe_value(val: &str) -> bool {
    if val.len() < 3 { return true; }

    if is_uuid(val) { return true; }
    if is_git_sha(val) { return true; }

    if val.contains('/') || val.contains('\\') { return true; }
    if val.starts_with("http") { return true; }
    if val.contains(' ') { return true; }
    if val.contains('.') && val.chars().all(|c| c.is_numeric() || c == '.') { return true; }

    let v_lower = val.to_lowercase();
    if v_lower.contains("example") 
        || v_lower.contains("xxxx") 
        || v_lower.contains("changeme") 
        || v_lower.contains("todo") 
        || v_lower.contains("your_api_key") {
        return true;
    }

    ALLOW_REGEXES.iter().any(|re| re.is_match(val))
}