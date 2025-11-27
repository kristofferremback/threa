-- ============================================================================
-- Dual Embedding Tables
-- ============================================================================
-- Two separate tables for different embedding dimensions:
-- - embeddings_768: For Ollama nomic-embed-text (local dev)
-- - embeddings_1536: For OpenAI text-embedding-3-small (production)
-- The app picks which table to use based on EMBEDDING_PROVIDER env var.
-- ============================================================================

-- Remove embedding column from text_messages (we'll use separate tables)
ALTER TABLE text_messages DROP COLUMN IF EXISTS embedding;
ALTER TABLE text_messages DROP COLUMN IF EXISTS embedded_at;

-- Table for 768-dim embeddings (Ollama)
CREATE TABLE IF NOT EXISTS embeddings_768 (
    text_message_id TEXT PRIMARY KEY REFERENCES text_messages(id) ON DELETE CASCADE,
    embedding vector(768) NOT NULL,
    model TEXT NOT NULL DEFAULT 'nomic-embed-text',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_embeddings_768_vector
    ON embeddings_768 USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Table for 1536-dim embeddings (OpenAI)
CREATE TABLE IF NOT EXISTS embeddings_1536 (
    text_message_id TEXT PRIMARY KEY REFERENCES text_messages(id) ON DELETE CASCADE,
    embedding vector(1536) NOT NULL,
    model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_embeddings_1536_vector
    ON embeddings_1536 USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Also update knowledge table to use separate tables
ALTER TABLE knowledge DROP COLUMN IF EXISTS embedding;

CREATE TABLE IF NOT EXISTS knowledge_embeddings_768 (
    knowledge_id TEXT PRIMARY KEY REFERENCES knowledge(id) ON DELETE CASCADE,
    embedding vector(768) NOT NULL,
    model TEXT NOT NULL DEFAULT 'nomic-embed-text',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_768_vector
    ON knowledge_embeddings_768 USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE TABLE IF NOT EXISTS knowledge_embeddings_1536 (
    knowledge_id TEXT PRIMARY KEY REFERENCES knowledge(id) ON DELETE CASCADE,
    embedding vector(1536) NOT NULL,
    model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_1536_vector
    ON knowledge_embeddings_1536 USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

COMMENT ON TABLE embeddings_768 IS 'Embeddings from Ollama nomic-embed-text (768 dims) for local dev';
COMMENT ON TABLE embeddings_1536 IS 'Embeddings from OpenAI text-embedding-3-small (1536 dims) for production';

