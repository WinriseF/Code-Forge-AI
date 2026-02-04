// ============================================================================
// Database Module
// ============================================================================

// Module exports
pub mod models;
pub mod init;
pub mod prompts;
pub mod url_history;
pub mod project_config;
pub mod secrets;
pub mod apps;
pub mod shell_history;

// Re-export public types
pub use models::*;
pub use init::{DbState, init_db};
