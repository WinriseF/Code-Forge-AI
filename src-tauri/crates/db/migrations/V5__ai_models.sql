CREATE TABLE IF NOT EXISTS ai_models (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK (
        category IN ('chat', 'translation', 'coding', 'vision', 'embedding', 'rerank', 'other')
    ),
    base_url TEXT NOT NULL,
    model_id TEXT NOT NULL,
    api_key TEXT NOT NULL,
    temperature REAL,
    max_tokens INTEGER,
    capabilities_json TEXT NOT NULL DEFAULT '{}',
    params_json TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
