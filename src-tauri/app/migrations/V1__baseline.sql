-- V1__baseline.sql
-- 这是项目的基准数据库结构，包含截至目前的所有字段

-- 1. Prompts 表（包含最新的字段）
CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    group_name TEXT NOT NULL,
    description TEXT,
    tags TEXT,
    is_favorite INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER,
    source TEXT DEFAULT 'local',
    pack_id TEXT,
    original_id TEXT,
    type TEXT,
    is_executable INTEGER DEFAULT 0,
    shell_type TEXT,
    use_as_chat_template INTEGER DEFAULT 0
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_prompts_group_created ON prompts (group_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompts_type ON prompts (type);
CREATE INDEX IF NOT EXISTS idx_prompts_favorite ON prompts (is_favorite);
CREATE INDEX IF NOT EXISTS idx_prompts_pack_id ON prompts (pack_id);

-- 2. URL History
CREATE TABLE IF NOT EXISTS url_history (
    url TEXT PRIMARY KEY,
    title TEXT,
    visit_count INTEGER DEFAULT 1,
    last_visit INTEGER
);

-- 3. Project Configs
CREATE TABLE IF NOT EXISTS project_configs (
    path TEXT PRIMARY KEY,
    config TEXT NOT NULL,
    updated_at INTEGER
);

-- 4. Ignored Secrets
CREATE TABLE IF NOT EXISTS ignored_secrets (
    id TEXT PRIMARY KEY,
    value TEXT NOT NULL UNIQUE,
    rule_id TEXT,
    created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ignored_value ON ignored_secrets (value);

-- 5. Apps
CREATE TABLE IF NOT EXISTS apps (
    path TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    keywords TEXT,
    icon TEXT,
    usage_count INTEGER DEFAULT 0,
    last_used_at INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_apps_name ON apps (name);
CREATE INDEX IF NOT EXISTS idx_apps_usage ON apps (usage_count DESC);

-- 6. Full Text Search (FTS)
DROP TABLE IF EXISTS prompts_fts;
CREATE VIRTUAL TABLE prompts_fts USING fts5(
    id, title, content, description, tags, group_name,
    tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO prompts_fts(id, title, content, description, tags, group_name)
SELECT id, title, content, description, tags, group_name FROM prompts;

DROP TRIGGER IF EXISTS prompts_ai;
DROP TRIGGER IF EXISTS prompts_ad;
DROP TRIGGER IF EXISTS prompts_au;

CREATE TRIGGER prompts_ai AFTER INSERT ON prompts BEGIN
    INSERT INTO prompts_fts(id, title, content, description, tags, group_name)
    VALUES (new.id, new.title, new.content, new.description, new.tags, new.group_name);
END;
CREATE TRIGGER prompts_ad AFTER DELETE ON prompts BEGIN
    DELETE FROM prompts_fts WHERE id = old.id;
END;
CREATE TRIGGER prompts_au AFTER UPDATE ON prompts BEGIN
    DELETE FROM prompts_fts WHERE id = old.id;
    INSERT INTO prompts_fts(id, title, content, description, tags, group_name)
    VALUES (new.id, new.title, new.content, new.description, new.tags, new.group_name);
END;

-- URL History FTS
DROP TABLE IF EXISTS url_history_fts;
CREATE VIRTUAL TABLE url_history_fts USING fts5(
    url, title,
    tokenize = 'unicode61 remove_diacritics 2'
);
INSERT INTO url_history_fts(url, title) SELECT url, title FROM url_history;

DROP TRIGGER IF EXISTS url_history_ai;
DROP TRIGGER IF EXISTS url_history_ad;
DROP TRIGGER IF EXISTS url_history_au;

CREATE TRIGGER url_history_ai AFTER INSERT ON url_history BEGIN
    INSERT INTO url_history_fts(url, title) VALUES (new.url, new.title);
END;
CREATE TRIGGER url_history_ad AFTER DELETE ON url_history BEGIN
    DELETE FROM url_history_fts WHERE url = old.url;
END;
CREATE TRIGGER url_history_au AFTER UPDATE ON url_history BEGIN
    DELETE FROM url_history_fts WHERE url = old.url;
    INSERT INTO url_history_fts(url, title) VALUES (new.url, new.title);
END;
