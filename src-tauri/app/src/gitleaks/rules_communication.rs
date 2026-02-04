use regex::Regex;
use super::Rule;

pub fn communication_rules() -> Vec<Rule> {
    vec![
        // Slack Webhook URL
        Rule {
            id: "slack-webhook",
            description: "Slack Webhook URL",
            regex: Regex::new(r"https://hooks.slack.com/services/T[A-Z0-9]{8,10}/B[A-Z0-9]{8,10}/[A-Za-z0-9]{24}").unwrap(),
            entropy: Some(3.0),
            keywords: &["hooks.slack.com/services"],
        },
        // Slack Bot Token
        Rule {
            id: "slack-bot-token",
            description: "Slack Bot Token",
            regex: Regex::new(r"xoxb-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24}").unwrap(),
            entropy: Some(3.8),
            keywords: &["xoxb-"],
        },
        // Slack User Token
        Rule {
            id: "slack-user-token",
            description: "Slack User Token",
            regex: Regex::new(r"xox[p|r|s|e]-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24}").unwrap(),
            entropy: Some(3.8),
            keywords: &["xoxp-", "xoxr-", "xoxs-", "xoxe-"],
        },

        // Discord Bot Token
        Rule {
            id: "discord-bot-token",
            description: "Discord Bot Token",
            regex: Regex::new(r"[MN][A-Za-z\\d]{23}\\.[XP][A-Za-z\\d]{5}\\.[A-Za-z\\d]{27}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },
        // Discord Webhook URL
        Rule {
            id: "discord-webhook",
            description: "Discord Webhook URL",
            regex: Regex::new(r"https://discord(app)?\\.com/api/webhooks/[0-9]{18,19}/[A-Za-z0-9_\\-]{68}").unwrap(),
            entropy: Some(3.8),
            keywords: &["discord.com/api/webhooks", "discordapp.com/api/webhooks"],
        },

        // Twilio API Key
        Rule {
            id: "twilio-api-key",
            description: "Twilio API Key",
            regex: Regex::new(r"SK[0-9a-fA-F]{32}").unwrap(),
            entropy: Some(3.5),
            keywords: &["SK"],
        },

        // Telegram Bot Token
        Rule {
            id: "telegram-bot-token",
            description: "Telegram Bot API Token",
            regex: Regex::new(r"[0-9]{8,10}:[A-Za-z0-9_\\-]{35}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },

        // Mailgun API Key
        Rule {
            id: "mailgun-api-key",
            description: "Mailgun API Key",
            regex: Regex::new(r"key-[0-9a-zA-Z]{32}").unwrap(),
            entropy: Some(3.5),
            keywords: &["key-"],
        },

        // SendGrid API Key
        Rule {
            id: "sendgrid-api-key",
            description: "SendGrid API Key",
            regex: Regex::new(r"SG\\.[0-9A-Za-z_\\-]{22}\\.[0-9A-Za-z_\\-]{43}").unwrap(),
            entropy: Some(3.8),
            keywords: &["SG."],
        },

        // Sendinblue (Brevo) API Key
        Rule {
            id: "sendinblue-api-key",
            description: "Sendinblue (Brevo) API Key",
            regex: Regex::new(r"xkeysib-[0-9a-f]{64}-[0-9a-f]{16}").unwrap(),
            entropy: Some(3.8),
            keywords: &["xkeysib-"],
        },

        // Mailchimp API Key
        Rule {
            id: "mailchimp-api-key",
            description: "Mailchimp API Key",
            regex: Regex::new(r"[0-9a-f]{32}-us[0-9]{1,2}").unwrap(),
            entropy: Some(3.5),
            keywords: &["-us"],
        },

        // MessageBird API Key
        Rule {
            id: "messagebird-api-key",
            description: "MessageBird API Key",
            regex: Regex::new(r"[A-Za-z0-9]{25}").unwrap(),
            entropy: Some(3.2),
            keywords: &[],
        },

        // Mattermost Personal Access Token
        Rule {
            id: "mattermost-token",
            description: "Mattermost Personal Access Token",
            regex: Regex::new(r"[a-z0-9]{26}").unwrap(),
            entropy: Some(3.2),
            keywords: &[],
        },

        // Asana Personal Access Token
        Rule {
            id: "asana-token",
            description: "Asana Personal Access Token",
            regex: Regex::new(r"[0-9]/[0-9a-zA-Z]{36}").unwrap(),
            entropy: Some(3.2),
            keywords: &[],
        },

        // HubSpot API Key
        Rule {
            id: "hubspot-api-key",
            description: "HubSpot API Key",
            regex: Regex::new(r"[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}").unwrap(),
            entropy: Some(3.0),
            keywords: &[],
        },

        // Intercom Access Token
        Rule {
            id: "intercom-access-token",
            description: "Intercom Access Token",
            regex: Regex::new(r"[A-Za-z0-9_]{40,}").unwrap(),
            entropy: Some(3.5),
            keywords: &[],
        },
    ]
}