-- =============================================================================
-- Attachment Extraction Embeddings for Semantic Search
-- =============================================================================
--
-- Adds a 1536-dimension embedding of the AI-generated `summary` so attachments
-- (PDFs, Word docs, text/markdown/code, captioned images) can be retrieved by
-- semantic similarity in addition to the existing tsvector full-text search.
--
-- We embed the summary rather than `full_text` because (1) it stays under the
-- 8K-token input cap for every extraction, (2) the summary captures the doc's
-- gist far better than raw text for high-recall "which doc is about X?"
-- queries, and (3) FTS already handles exact-phrase lookups on `full_text`.
-- Per-section/per-page chunked embeddings are out of scope for this pass.
--
-- Photo and "other" content_types are excluded from embedding (their summaries
-- are too generic to help retrieval); the worker enforces this at runtime.

ALTER TABLE attachment_extractions ADD COLUMN summary_embedding vector(1536);

-- HNSW index for approximate nearest neighbor search.
-- Cosine distance matches the message embeddings index (idx_messages_embedding)
-- so callers can build hybrid queries with consistent distance semantics.
CREATE INDEX idx_attachment_extractions_summary_embedding ON attachment_extractions
    USING hnsw (summary_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
