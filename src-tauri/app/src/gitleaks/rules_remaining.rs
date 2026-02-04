use regex::Regex;
use super::Rule;

pub fn remaining_rules() -> Vec<Rule> {
    vec![
        // Bitbucket Access Token
        Rule {
            id: "bitbucket-access-token",
            description: "Bitbucket Access Token",
            regex: Regex::new(r"[0-9a-zA-Z]{32}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // GitLab Personal Access Token
        Rule {
            id: "gitlab-pat",
            description: "GitLab Personal Access Token",
            regex: Regex::new(r"glpat-[0-9A-Za-z\\-_]{20}").unwrap(),
            entropy: Some(3.5),
            keywords: &["glpat-"],
        },

        // Artifactory API Key
        Rule {
            id: "artifactory-api-key",
            description: "JFrog Artifactory API Key",
            regex: Regex::new(r"(AKC[a-zA-Z0-9]{10,})").unwrap(),
            entropy: Some(3.5),
            keywords: &["AKC"],
        },

        // Snyk API Token
        Rule {
            id: "snyk-api-token",
            description: "Snyk API Token",
            regex: Regex::new(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").unwrap(),
            entropy: Some(3.0),
            keywords: &[],
        },

        // Postman API Key
        Rule {
            id: "postman-api-key",
            description: "Postman API Key",
            regex: Regex::new(r"PMAK-[0-9a-f]{24}-[0-9a-f]{12}").unwrap(),
            entropy: Some(3.5),
            keywords: &["PMAK-"],
        },

        // Notion Integration Token
        Rule {
            id: "notion-token",
            description: "Notion Integration Token",
            regex: Regex::new(r"secret_[A-Za-z0-9]{43}").unwrap(),
            entropy: Some(3.5),
            keywords: &["secret_"],
        },

        // Linear API Key
        Rule {
            id: "linear-api-key",
            description: "Linear API Key",
            regex: Regex::new(r"lin_api_[0-9a-zA-Z]{40}").unwrap(),
            entropy: Some(3.5),
            keywords: &["lin_api_"],
        },

        // LaunchDarkly Access Token
        Rule {
            id: "launchdarkly-token",
            description: "LaunchDarkly Access Token",
            regex: Regex::new(r"[0-9a-zA-Z]{40}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // Okta Access Token
        Rule {
            id: "okta-access-token",
            description: "Okta Access Token",
            regex: Regex::new(r"00[a-zA-Z0-9]{40,}").unwrap(),
            entropy: Some(3.5),
            keywords: &["00"],
        },

        // 1Password Service Account Token
        Rule {
            id: "1password-service-account-token",
            description: "1Password Service Account Token",
            regex: Regex::new(r"ops_eyJ[a-zA-Z0-9+/]{250,}={0,3}").unwrap(),
            entropy: Some(4.0),
            keywords: &["ops_eyj"],
        },

        // PlanetScale Password / Database Password
        Rule {
            id: "planetscale-password",
            description: "PlanetScale Database Password",
            regex: Regex::new(r"pscale_pw_[0-9a-zA-Z]{40,}").unwrap(),
            entropy: Some(3.8),
            keywords: &["pscale_pw_"],
        },

        // Prefect API Key
        Rule {
            id: "prefect-api-key",
            description: "Prefect API Key",
            regex: Regex::new(r"pnu_[0-9a-zA-Z]{38}").unwrap(),
            entropy: Some(3.5),
            keywords: &["pnu_"],
        },

        // RapidAPI Key
        Rule {
            id: "rapidapi-key",
            description: "RapidAPI Access Key",
            regex: Regex::new(r"[0-9a-zA-Z]{50}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // Readme.io API Key
        Rule {
            id: "readme-api-key",
            description: "Readme.io API Key",
            regex: Regex::new(r"rdme_[0-9a-zA-Z]{40}").unwrap(),
            entropy: Some(3.5),
            keywords: &["rdme_"],
        },

        // Scalingo API Token
        Rule {
            id: "scalingo-api-token",
            description: "Scalingo API Token",
            regex: Regex::new(r"tk-us-[0-9a-zA-Z]{48}").unwrap(),
            entropy: Some(3.5),
            keywords: &["tk-us-"],
        },

        // Sendbird Access Token
        Rule {
            id: "sendbird-access-token",
            description: "Sendbird Access Token",
            regex: Regex::new(r"[0-9a-f]{40}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // Sentry Access Token
        Rule {
            id: "sentry-access-token",
            description: "Sentry Access Token",
            regex: Regex::new(r"[0-9a-f]{64}").unwrap(),
            entropy: Some(3.8),
            keywords: &[],
        },

        // Shopify Shared Secret / Private App Password
        Rule {
            id: "shopify-shared-secret",
            description: "Shopify Shared Secret",
            regex: Regex::new(r"shpss_[0-9a-f]{32}").unwrap(),
            entropy: Some(3.5),
            keywords: &["shpss_"],
        },
        // Shopify Access Token
        Rule {
            id: "shopify-access-token",
            description: "Shopify Access Token",
            regex: Regex::new(r"shpat_[0-9a-f]{32}").unwrap(),
            entropy: Some(3.5),
            keywords: &["shpat_"],
        },

        // SonarQube Token
        Rule {
            id: "sonarqube-token",
            description: "SonarQube User Token",
            regex: Regex::new(r"[0-9a-f]{40}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // SquareSpace API Key
        Rule {
            id: "squarespace-api-key",
            description: "SquareSpace API Key",
            regex: Regex::new(r"[0-9a-f]{32}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // Typeform Access Token
        Rule {
            id: "typeform-access-token",
            description: "Typeform Access Token",
            regex: Regex::new(r"tfp_[0-9a-z\\-_]{40,}").unwrap(),
            entropy: Some(3.5),
            keywords: &["tfp_"],
        },
    ]
}