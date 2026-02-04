-- ---------------------------------------------------------
-- Refinery: 轻量化剪贴板加工站 (支持文本与图片)
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS refinery_history (
    id TEXT PRIMARY KEY,                -- UUID
    kind TEXT NOT NULL,                 -- 类型: 'text' 或 'image'

    -- 内容存储
    -- 如果是 text: 存储完整字符串
    -- 如果是 image: 存储本地缓存路径或缩略图 Base64 (取决于存储策略)
    content TEXT,

    -- 去重核心
    content_hash TEXT NOT NULL,         -- 内容哈希，用于秒速去重

    -- UI 展现字段
    preview TEXT,                       -- 预览：文本截断或图片微缩图
    source_app TEXT,                    -- 来源应用 (VSCode, Chrome 等)
    url TEXT,                            -- 浏览器 URL (仅浏览器复制时有效)

    -- 统计信息
    size_info TEXT,                     -- 文本存储 "125 chars", 图片存储 "1920x1080"

    -- 状态
    is_pinned INTEGER DEFAULT 0,        -- 收藏

    -- 扩展元数据 (JSON)
    -- 存储：语言类型 (lang)、完整图片路径 (path)、Token数 (tokens) 等
    metadata TEXT DEFAULT '{}',

    -- 强时间属性
    created_at INTEGER NOT NULL,        -- 首次复制时间戳
    updated_at INTEGER NOT NULL         -- 最后活跃时间戳 (重复复制时刷新此时间)
);

-- ---------------------------------------------------------
-- 索引设计：为了极致的筛选速度
-- ---------------------------------------------------------

-- 1. 唯一哈希索引：确保相同内容不重复入库，实现 Upsert 逻辑
CREATE UNIQUE INDEX IF NOT EXISTS idx_refinery_hash ON refinery_history(content_hash);

-- 2. 时间线索引：最常用的筛选方式 (最新在前)
CREATE INDEX IF NOT EXISTS idx_refinery_timeline ON refinery_history(updated_at DESC);

-- 3. 类型筛选索引：方便只看图片或只看文本
CREATE INDEX IF NOT EXISTS idx_refinery_kind ON refinery_history(kind, updated_at DESC);

-- 4. 来源应用索引：方便按应用筛选
CREATE INDEX IF NOT EXISTS idx_refinery_source ON refinery_history(source_app);
