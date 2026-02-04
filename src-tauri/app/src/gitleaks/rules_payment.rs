use regex::Regex;
use super::Rule;

pub fn payment_rules() -> Vec<Rule> {
    vec![
        // Stripe Secret Key (Live & Test)
        Rule {
            id: "stripe-secret-key",
            description: "Stripe Secret Key",
            regex: Regex::new(r"sk_(live|test)_[0-9a-zA-Z]{24}").unwrap(),
            entropy: Some(3.5),
            keywords: &["sk_live_", "sk_test_"],
        },
        // Stripe Publishable Key
        Rule {
            id: "stripe-publishable-key",
            description: "Stripe Publishable Key",
            regex: Regex::new(r"pk_(live|test)_[0-9a-zA-Z]{24}").unwrap(),
            entropy: Some(3.0),
            keywords: &["pk_live_", "pk_test_"],
        },
        // Stripe Restricted Key
        Rule {
            id: "stripe-restricted-key",
            description: "Stripe Restricted Key",
            regex: Regex::new(r"rk_(live|test)_[0-9a-zA-Z]{24}").unwrap(),
            entropy: Some(3.5),
            keywords: &["rk_live_", "rk_test_"],
        },

        // Square Access Token
        Rule {
            id: "square-access-token",
            description: "Square Access Token",
            regex: Regex::new(r"sq0atp-[0-9A-Za-z\\-_]{22}").unwrap(),
            entropy: Some(3.2),
            keywords: &["sq0atp-"],
        },
        // Square OAuth Secret
        Rule {
            id: "square-oauth-secret",
            description: "Square OAuth Secret",
            regex: Regex::new(r"sq0csp-[0-9A-Za-z\\-_]{43}").unwrap(),
            entropy: Some(3.5),
            keywords: &["sq0csp-"],
        },

        // PayPal Braintree Access Token
        Rule {
            id: "paypal-braintree-access-token",
            description: "PayPal Braintree Access Token",
            regex: Regex::new(r"access_token\\$production\\$[0-9a-z]{16}\\$[0-9a-f]{32}").unwrap(),
            entropy: Some(3.8),
            keywords: &["access_token$production"],
        },

        // Plaid Client ID / Secret
        Rule {
            id: "plaid-client-id",
            description: "Plaid Client ID",
            regex: Regex::new(r"^[0-9a-f]{24}$").unwrap(),
            entropy: Some(3.0),
            keywords: &[],
        },
        Rule {
            id: "plaid-secret",
            description: "Plaid Secret / API Key",
            regex: Regex::new(r"^[0-9a-f]{30}$").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // Coinbase API Key
        Rule {
            id: "coinbase-api-key",
            description: "Coinbase API Key",
            regex: Regex::new(r"[0-9a-f]{32}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // Finicity API Key
        Rule {
            id: "finicity-api-key",
            description: "Finicity API Key",
            regex: Regex::new(r"[0-9a-f]{32}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },
        // Finicity App Key
        Rule {
            id: "finicity-app-key",
            description: "Finicity App Key",
            regex: Regex::new(r"[0-9a-f]{32}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // Flutterwave Secret Key
        Rule {
            id: "flutterwave-secret-key",
            description: "Flutterwave Secret Key",
            regex: Regex::new(r"FLWSECK-[0-9a-zA-Z]{32}-X").unwrap(),
            entropy: Some(3.2),
            keywords: &["FLWSECK-"],
        },
        // Flutterwave Public Key
        Rule {
            id: "flutterwave-public-key",
            description: "Flutterwave Public Key",
            regex: Regex::new(r"FLWPUBK-[0-9a-zA-Z]{32}-X").unwrap(),
            entropy: Some(3.0),
            keywords: &["FLWPUBK-"],
        },

        // GoCardless Access Token
        Rule {
            id: "gocardless-access-token",
            description: "GoCardless Access Token",
            regex: Regex::new(r"live_[0-9a-zA-Z]{40}|sandbox_[0-9a-zA-Z]{40}").unwrap(),
            entropy: Some(3.5),
            keywords: &["live_", "sandbox_"],
        },
    ]
}