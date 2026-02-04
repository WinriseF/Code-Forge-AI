use regex::Regex;
use super::Rule;

pub fn cloud_rules() -> Vec<Rule> {
    vec![
        // AWS Access Key ID
        Rule {
            id: "aws-access-key-id",
            description: "AWS Access Key ID",
            regex: Regex::new(r"(AKIA|ASIA|AROA|AIDA)[0-9A-Z]{16}").unwrap(),
            entropy: Some(3.0),
            keywords: &["akia", "asia", "aroa", "aida"],
        },
        // AWS Secret Access Key
        Rule {
            id: "aws-secret-access-key",
            description: "AWS Secret Access Key",
            regex: Regex::new(r"[0-9a-zA-Z/+]{40}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },
        // AWS Session Token (temporary credentials)
        Rule {
            id: "aws-session-token",
            description: "AWS Session Token",
            regex: Regex::new(r"(?i)AQoDYXdzE[0-9a-zA-Z/+]{100,}={0,2}").unwrap(),
            entropy: Some(3.2),
            keywords: &["aqodyxdze", "aqodyxdz"],
        },
        // AWS MWS Key
        Rule {
            id: "aws-mws-key",
            description: "Amazon Marketplace Web Service Key",
            regex: Regex::new(r"amzn\.mws\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").unwrap(),
            entropy: Some(3.0),
            keywords: &["amzn.mws."],
        },

        // Azure Client ID / Application ID
        Rule {
            id: "azure-client-id",
            description: "Azure Client ID",
            regex: Regex::new(r"[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}").unwrap(),
            entropy: Some(2.8),
            keywords: &[],
        },
        // Azure Tenant ID
        Rule {
            id: "azure-tenant-id",
            description: "Azure Tenant ID",
            regex: Regex::new(r"[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}").unwrap(),
            entropy: Some(2.8),
            keywords: &[],
        },
        // Azure Client Secret
        Rule {
            id: "azure-client-secret",
            description: "Azure Client Secret",
            regex: Regex::new(r"[~]{0,1}[0-9a-zA-Z+/=]{44}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // Google Cloud API Key
        Rule {
            id: "gcp-api-key",
            description: "Google Cloud API Key",
            regex: Regex::new(r"AIza[0-9A-Za-z\\-_]{35}").unwrap(),
            entropy: Some(3.2),
            keywords: &["aiza"],
        },
        // Google OAuth Access Token
        Rule {
            id: "gcp-oauth-token",
            description: "Google OAuth Access Token",
            regex: Regex::new(r"ya29\.[0-9A-Za-z\-_]+").unwrap(),
            entropy: Some(3.5),
            keywords: &["ya29."],
        },
        // Google Service Account Key
        Rule {
            id: "gcp-service-account",
            description: "Google Service Account JSON Key",
            regex: Regex::new(r#""type": "service_account""#).unwrap(),
            entropy: None,
            keywords: &["service_account"],
        },

        // DigitalOcean Personal Access Token
        Rule {
            id: "digitalocean-token",
            description: "DigitalOcean Personal Access Token",
            regex: Regex::new(r"do[v0][0-9a-zA-Z]{40}").unwrap(),
            entropy: Some(3.5),
            keywords: &["dov0"],
        },

        // Heroku API Key
        Rule {
            id: "heroku-api-key",
            description: "Heroku API Key",
            regex: Regex::new(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").unwrap(),
            entropy: Some(3.0),
            keywords: &[],
        },

        // Cloudflare API Key / Global API Key
        Rule {
            id: "cloudflare-api-key",
            description: "Cloudflare Global API Key",
            regex: Regex::new(r"[0-9a-z]{37}").unwrap(),
            entropy: Some(3.2),
            keywords: &[],
        },
        // Cloudflare API Token
        Rule {
            id: "cloudflare-api-token",
            description: "Cloudflare API Token",
            regex: Regex::new(r"[A-Za-z0-9_\\-]{40}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // Alibaba Cloud Access Key ID
        Rule {
            id: "alibaba-access-key-id",
            description: "Alibaba Cloud Access Key ID",
            regex: Regex::new(r"LTAI[0-9a-zA-Z]{16}").unwrap(),
            entropy: Some(3.0),
            keywords: &["ltai"],
        },
        // Alibaba Cloud Access Key Secret
        Rule {
            id: "alibaba-access-key-secret",
            description: "Alibaba Cloud Access Key Secret",
            regex: Regex::new(r"[0-9a-zA-Z]{30}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // HashiCorp Terraform Cloud Token
        Rule {
            id: "hashicorp-terraform-token",
            description: "HashiCorp Terraform Cloud/Enterprise Token",
            regex: Regex::new(r"[0-9a-zA-Z]{14}\.atlasv1\.[0-9a-zA-Z+=/]{80,}").unwrap(),
            entropy: Some(3.8),
            keywords: &["atlasv1"],
        },

        // HashiCorp Vault Token
        Rule {
            id: "hashicorp-vault-token",
            description: "HashiCorp Vault Token",
            regex: Regex::new(r"[sb]\.[0-9a-zA-Z]{24}").unwrap(),
            entropy: Some(3.2),
            keywords: &["s.", "b."],
        },
    ]
}