use once_cell::sync::Lazy;
use super::Rule;

use super::rules_cloud::cloud_rules;
use super::rules_ai::ai_rules;
use super::rules_payment::payment_rules;
use super::rules_communication::communication_rules;
use super::rules_package::package_and_generic_rules;
use super::rules_remaining::remaining_rules;

static ALL_RULES: Lazy<Vec<Rule>> = Lazy::new(|| {
    let mut rules = Vec::new();

    rules.extend(cloud_rules());
    rules.extend(ai_rules());
    rules.extend(payment_rules());
    rules.extend(communication_rules());
    rules.extend(package_and_generic_rules());
    rules.extend(remaining_rules());

    rules
});

pub fn get_all_rules() -> &'static [Rule] {
    &ALL_RULES
}