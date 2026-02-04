use regex::Regex;
use super::Rule;

pub fn package_and_generic_rules() -> Vec<Rule> {
    vec![
        // npm Access Token
        Rule {
            id: "npm-access-token",
            description: "npm Access Token",
            regex: Regex::new(r"(?i)[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}").unwrap(),
            entropy: Some(3.0),
            keywords: &[],
        },

        // PyPI API Token
        Rule {
            id: "pypi-api-token",
            description: "PyPI API Token",
            regex: Regex::new(r"pypi-AgEIcHlwaS5vcmc[A-Za-z0-9=_\\-]{50,}").unwrap(),
            entropy: Some(3.5),
            keywords: &["pypi-ageicHlwaS5vcmc"],
        },

        // RubyGems API Key
        Rule {
            id: "rubygems-api-key",
            description: "RubyGems API Key",
            regex: Regex::new(r"rubygems_[0-9a-f]{48}").unwrap(),
            entropy: Some(3.5),
            keywords: &["rubygems_"],
        },

        // NuGet API Key
        Rule {
            id: "nuget-api-key",
            description: "NuGet API Key",
            regex: Regex::new(r"oy2[a-z0-9]{38}").unwrap(),
            entropy: Some(3.2),
            keywords: &["oy2"],
        },

        // GitHub Personal Access Token (classic)
        Rule {
            id: "github-pat-classic",
            description: "GitHub Personal Access Token (Classic)",
            regex: Regex::new(r"ghp_[0-9a-zA-Z]{36}").unwrap(),
            entropy: Some(3.5),
            keywords: &["ghp_"],
        },
        // GitHub Fine-grained PAT
        Rule {
            id: "github-pat-fine-grained",
            description: "GitHub Fine-grained Personal Access Token",
            regex: Regex::new(r"github_pat_[0-9a-zA-Z_]{82}").unwrap(),
            entropy: Some(3.8),
            keywords: &["github_pat_"],
        },
        // GitHub OAuth App Token
        Rule {
            id: "github-oauth-token",
            description: "GitHub OAuth App Token",
            regex: Regex::new(r"gho_[0-9a-zA-Z]{36}").unwrap(),
            entropy: Some(3.5),
            keywords: &["gho_"],
        },
        // GitHub Refresh Token
        Rule {
            id: "github-refresh-token",
            description: "GitHub Refresh Token",
            regex: Regex::new(r"ghr_[0-9a-zA-Z]{36}").unwrap(),
            entropy: Some(3.5),
            keywords: &["ghr_"],
        },

        // JWT (JSON Web Token)
        Rule {
            id: "jwt",
            description: "JSON Web Token",
            regex: Regex::new(r"ey[A-Za-z0-9=_\\-]{10,}\\.(?:[A-Za-z0-9=_\\-]{10,}\\.)?[A-Za-z0-9=_\\-]{10,}").unwrap(),
            entropy: Some(3.0),
            keywords: &["ey"],
        },

        // Private Key (generic)
        Rule {
            id: "private-key",
            description: "Generic Private Key",
            regex: Regex::new(r"-----BEGIN [A-Z ]+ PRIVATE KEY-----").unwrap(),
            entropy: None,
            keywords: &["-----BEGIN", "PRIVATE KEY"],
        },
        // OpenSSH Private Key
        Rule {
            id: "openssh-private-key",
            description: "OpenSSH Private Key",
            regex: Regex::new(r"-----BEGIN OPENSSH PRIVATE KEY-----").unwrap(),
            entropy: None,
            keywords: &["-----BEGIN OPENSSH PRIVATE KEY-----"],
        },
        // RSA Private Key
        Rule {
            id: "rsa-private-key",
            description: "RSA Private Key",
            regex: Regex::new(r"-----BEGIN RSA PRIVATE KEY-----").unwrap(),
            entropy: None,
            keywords: &["-----BEGIN RSA PRIVATE KEY-----"],
        },
        // EC Private Key
        Rule {
            id: "ec-private-key",
            description: "EC Private Key",
            regex: Regex::new(r"-----BEGIN EC PRIVATE KEY-----").unwrap(),
            entropy: None,
            keywords: &["-----BEGIN EC PRIVATE KEY-----"],
        },

        // 增强规则：通用敏感字段检测 (High Confidence Generic Fields)
        // 针对：password, access_key, secret_key, apiV3Key 等常见字段
        // 匹配：16~128位的高熵字符串
        Rule {
            id: "common-credential-field",
            description: "Detected a common credential field with a high entropy value",
            regex: Regex::new(r#"(?i)(?:password|passwd|pass|pwd|secret|secret[_-]?key|access[_-]?key|api[_-]?key|api[_-]?v3[_-]?key|token|auth[_-]?token|key|credential)["']?\s*(?::|=|:=|=>)\s*["']?(?P<secret>[a-zA-Z0-9_\-]{16,128})["']?"#).unwrap(),
            entropy: Some(3.0), 
            
            keywords: &[
                "password", "passwd", "pass", "pwd", 
                "secret", "key", "token", "auth", "credential"
            ],
        },

        // Generic API Key (high entropy 40+ chars)
        Rule {
            id: "generic-api-key",
            description: "Generic High Entropy API Key",
            regex: Regex::new(r"(?i)(api[_-]?key|apikey|secret)[0-9a-zA-Z]{32,45}").unwrap(),
            entropy: Some(3.5),
            keywords: &["api_key", "apikey", "api-key", "secret"],
        },
        // Generic Secret (very high entropy)
        Rule {
            id: "generic-secret",
            description: "Generic High Entropy Secret",
            regex: Regex::new(r"[0-9a-zA-Z/+]{64,}").unwrap(),
            entropy: Some(4.0),
            keywords: &[],
        },

        // Age Secret Key
        Rule {
            id: "age-secret-key",
            description: "Age Encryption Secret Key",
            regex: Regex::new(r"AGE-SECRET-KEY-1[A-Z0-9]{58,}").unwrap(),
            entropy: Some(3.8),
            keywords: &["AGE-SECRET-KEY-"],
        },

        // Doppler Token
        Rule {
            id: "doppler-token",
            description: "Doppler Token",
            regex: Regex::new(r"dp\\.pt\\.[a-z0-9]{30,}").unwrap(),
            entropy: Some(3.5),
            keywords: &["dp.pt."],
        },

        // Fastly API Key
        Rule {
            id: "fastly-api-key",
            description: "Fastly API Key",
            regex: Regex::new(r"[0-9a-zA-Z]{32}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // New Relic License Key
        Rule {
            id: "newrelic-license-key",
            description: "New Relic License Key",
            regex: Regex::new(r"[0-9a-f]{40}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // Datadog API Key
        Rule {
            id: "datadog-api-key",
            description: "Datadog API Key",
            regex: Regex::new(r"[0-9a-f]{32}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },
    ]
}