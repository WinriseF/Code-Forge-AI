use regex::Regex;
use once_cell::sync::Lazy;

static C_STYLE_BLOCK: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)/\*.*?\*/").unwrap());
static C_STYLE_LINE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)//.*$").unwrap());
static PYTHON_STYLE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)#.*$").unwrap());
static HTML_STYLE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<!--.*?-->").unwrap());

pub fn strip_comments(content: &str, ext: &str) -> String {
    match ext {
        "js" | "jsx" | "ts" | "tsx" | "rs" | "go" | "java" | "c" | "cpp" | "h" | "cs" | "kt" | "swift" | "dart" => {
            let no_block = C_STYLE_BLOCK.replace_all(content, "");
            C_STYLE_LINE.replace_all(&no_block, "").to_string()
        },
        "py" | "sh" | "bash" | "rb" | "pl" | "yaml" | "yml" | "toml" | "dockerfile" => {
            PYTHON_STYLE.replace_all(content, "").to_string()
        },
        "html" | "xml" | "svg" | "vue" | "svelte" => {
            HTML_STYLE.replace_all(content, "").to_string()
        },
        "css" | "scss" | "less" => {
            C_STYLE_BLOCK.replace_all(content, "").to_string()
        },
        "sql" => {
            let sql_comment = Regex::new(r"(?m)--.*$").unwrap();
            sql_comment.replace_all(content, "").to_string()
        },
        _ => content.to_string()
    }
}
