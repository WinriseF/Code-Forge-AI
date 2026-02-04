-- src-tauri/migrations/V2__shell_history.sql

CREATE TABLE IF NOT EXISTS shell_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    execution_count INTEGER NOT NULL DEFAULT 1,
    UNIQUE(command)
);

CREATE INDEX IF NOT EXISTS idx_shell_history_timestamp ON shell_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_shell_history_command ON shell_history(command);
