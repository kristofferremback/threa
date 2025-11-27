-- ============================================================================
-- Flexible Embedding Dimension
-- ============================================================================
-- Changes the embedding column to 768 dimensions for Ollama compatibility.
-- Production can use 1536 by setting EMBEDDING_DIMENSION=1536 and re-running.
-- ============================================================================

-- Drop the old column and index (if exists)
DROP INDEX IF EXISTS idx_text_messages_embedding;
ALTER TABLE text_messages DROP COLUMN IF EXISTS embedding;

-- Create with 768 dimensions (Ollama nomic-embed-text)
-- For production with OpenAI, set EMBEDDING_DIMENSION=1536 and modify this migration
ALTER TABLE text_messages ADD COLUMN embedding vector(768);
ALTER TABLE text_messages ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

-- Recreate index
CREATE INDEX IF NOT EXISTS idx_text_messages_embedding
    ON text_messages USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Also update knowledge table
DROP INDEX IF EXISTS idx_knowledge_embedding;
ALTER TABLE knowledge DROP COLUMN IF EXISTS embedding;
ALTER TABLE knowledge ADD COLUMN embedding vector(768);

CREATE INDEX IF NOT EXISTS idx_knowledge_embedding
    ON knowledge USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Add comment about dimension
COMMENT ON COLUMN text_messages.embedding IS '768-dim vector for semantic search (Ollama nomic-embed-text). Use 1536 for OpenAI text-embedding-3-small.';

