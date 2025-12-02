-- ============================================================================
-- Event Embeddings Tables
-- ============================================================================
-- Separate embedding tables for stream events.
-- These map event_id to embeddings, allowing similarity search across events
-- regardless of content type.
-- ============================================================================

-- Table for 768-dim event embeddings (Ollama)
CREATE TABLE IF NOT EXISTS event_embeddings_768 (
    event_id TEXT PRIMARY KEY REFERENCES stream_events(id) ON DELETE CASCADE,
    embedding vector(768) NOT NULL,
    model TEXT NOT NULL DEFAULT 'nomic-embed-text',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_embeddings_768_vector
    ON event_embeddings_768 USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Table for 1536-dim event embeddings (OpenAI)
CREATE TABLE IF NOT EXISTS event_embeddings_1536 (
    event_id TEXT PRIMARY KEY REFERENCES stream_events(id) ON DELETE CASCADE,
    embedding vector(1536) NOT NULL,
    model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_embeddings_1536_vector
    ON event_embeddings_1536 USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Memo embeddings (for similarity checking against memos)
CREATE TABLE IF NOT EXISTS memo_embeddings_768 (
    memo_id TEXT PRIMARY KEY REFERENCES memos(id) ON DELETE CASCADE,
    embedding vector(768) NOT NULL,
    model TEXT NOT NULL DEFAULT 'nomic-embed-text',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memo_embeddings_768_vector
    ON memo_embeddings_768 USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE TABLE IF NOT EXISTS memo_embeddings_1536 (
    memo_id TEXT PRIMARY KEY REFERENCES memos(id) ON DELETE CASCADE,
    embedding vector(1536) NOT NULL,
    model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memo_embeddings_1536_vector
    ON memo_embeddings_1536 USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

COMMENT ON TABLE event_embeddings_768 IS 'Event embeddings from Ollama (768 dims) for local dev';
COMMENT ON TABLE event_embeddings_1536 IS 'Event embeddings from OpenAI (1536 dims) for production';
COMMENT ON TABLE memo_embeddings_768 IS 'Memo embeddings from Ollama (768 dims) for local dev';
COMMENT ON TABLE memo_embeddings_1536 IS 'Memo embeddings from OpenAI (1536 dims) for production';
