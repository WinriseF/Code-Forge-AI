use tiktoken_rs::CoreBPE;
use once_cell::sync::Lazy;

static BPE: Lazy<CoreBPE> = Lazy::new(|| {
    tiktoken_rs::cl100k_base().expect("Failed to load cl100k_base tokenizer")
});

pub fn count_tokens(text: &str) -> usize {
    BPE.encode_ordinary(text).len()
}

#[allow(dead_code)]
pub fn estimate_tokens(text: &str) -> usize {
    text.len() / 4
}
