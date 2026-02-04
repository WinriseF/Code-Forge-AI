-- V4__refinery_notes.sql
-- 目标：将 Refinery 升级为支持编辑、标题和标签的记事本

-- 1. 移除 content_hash 的唯一索引约束
--    原因：允许用户创建多条内容相同的笔记，或手动编辑后内容重复
DROP INDEX IF EXISTS idx_refinery_hash;

-- 2. 重新创建普通索引 (非 Unique)，用于 Worker 快速查找去重
CREATE INDEX IF NOT EXISTS idx_refinery_hash ON refinery_history(content_hash);

-- 3. 添加新字段
ALTER TABLE refinery_history ADD COLUMN title TEXT;           -- 笔记标题
ALTER TABLE refinery_history ADD COLUMN tags TEXT;            -- 标签 (JSON Array)
ALTER TABLE refinery_history ADD COLUMN is_manual INTEGER DEFAULT 0; -- 0=自动捕获, 1=手动创建
ALTER TABLE refinery_history ADD COLUMN is_edited INTEGER DEFAULT 0; -- 0=原始, 1=已编辑

-- 4. 创建 FTS5 虚拟表以支持全文搜索 (标题 + 内容 + 来源)
CREATE VIRTUAL TABLE IF NOT EXISTS refinery_fts USING fts5(
    content,
    title,
    source_app,
    preview,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- 5. 配置触发器：当 refinery_history 变动时自动更新 FTS 表
--    注意：只索引文本类型 (kind='text')

-- Insert Trigger
CREATE TRIGGER IF NOT EXISTS refinery_ai AFTER INSERT ON refinery_history
WHEN new.kind = 'text'
BEGIN
    INSERT INTO refinery_fts(rowid, content, title, source_app, preview)
    VALUES (new.rowid, new.content, new.title, new.source_app, new.preview);
END;

-- Delete Trigger
CREATE TRIGGER IF NOT EXISTS refinery_ad AFTER DELETE ON refinery_history
WHEN old.kind = 'text'
BEGIN
    DELETE FROM refinery_fts WHERE rowid = old.rowid;
END;

-- Update Trigger
CREATE TRIGGER IF NOT EXISTS refinery_au AFTER UPDATE ON refinery_history
WHEN new.kind = 'text'
BEGIN
    DELETE FROM refinery_fts WHERE rowid = old.rowid;
    INSERT INTO refinery_fts(rowid, content, title, source_app, preview)
    VALUES (new.rowid, new.content, new.title, new.source_app, new.preview);
END;
