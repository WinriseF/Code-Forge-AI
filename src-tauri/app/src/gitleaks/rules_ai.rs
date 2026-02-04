use regex::Regex;
use super::Rule;

pub fn ai_rules() -> Vec<Rule> {
    vec![
        // OpenAI API Key
        Rule {
            id: "openai-api-key",
            description: "OpenAI API Key",
            regex: Regex::new(r"sk-[0-9a-zA-Z]{48}").unwrap(),
            entropy: Some(3.5),
            keywords: &["sk-"],
        },
        // OpenAI Organization ID (optional but often leaked)
        Rule {
            id: "openai-org-id",
            description: "OpenAI Organization ID",
            regex: Regex::new(r"org-[0-9a-zA-Z]{24}").unwrap(),
            entropy: Some(3.0),
            keywords: &["org-"],
        },

        // Anthropic API Key
        Rule {
            id: "anthropic-api-key",
            description: "Anthropic API Key",
            regex: Regex::new(r"sk-ant-[0-9a-zA-Z]{48,}").unwrap(),
            entropy: Some(3.5),
            keywords: &["sk-ant-"],
        },

        // Cohere API Key
        Rule {
            id: "cohere-api-key",
            description: "Cohere API Key",
            regex: Regex::new(r"[0-9a-zA-Z]{40}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // Hugging Face Access Token
        Rule {
            id: "huggingface-token",
            description: "Hugging Face Access Token",
            regex: Regex::new(r"hf_[0-9a-zA-Z]{40}").unwrap(),
            entropy: Some(3.5),
            keywords: &["hf_"],
        },

        // Perplexity API Key
        Rule {
            id: "perplexity-api-key",
            description: "Perplexity AI API Key",
            regex: Regex::new(r"pplx-[0-9a-zA-Z]{40,}").unwrap(),
            entropy: Some(3.5),
            keywords: &["pplx-"],
        },

        // PrivateAI API Key (private.ai)
        Rule {
            id: "privateai-api-key",
            description: "PrivateAI API Key",
            regex: Regex::new(r"pk_live_[0-9a-zA-Z]{40,}").unwrap(),
            entropy: Some(3.5),
            keywords: &["pk_live_"],
        },

        // DeepSeek API Key
        Rule {
            id: "deepseek-api-key",
            description: "DeepSeek API Key",
            regex: Regex::new(r"sk-[0-9a-zA-Z]{32}").unwrap(),
            entropy: Some(3.2),
            keywords: &["sk-"],
        },
    ]
}