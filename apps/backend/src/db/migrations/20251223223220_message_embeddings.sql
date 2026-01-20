-- =============================================================================
-- Message Embeddings for Semantic Search
-- =============================================================================

-- Add embedding column for vector search (1536 dimensions for OpenAI embeddings)
ALTER TABLE messages ADD COLUMN embedding vector(1536);

-- HNSW index for approximate nearest neighbor search
-- HNSW works on empty tables (unlike ivfflat which requires rows first)
CREATE INDEX idx_messages_embedding ON messages
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
