-- Create attachment_extractions table for storing extracted image content
-- Separate from attachments table to enable proper indexing, future embeddings, and complex queries

CREATE TABLE attachment_extractions (
    id TEXT PRIMARY KEY,                          -- extract_<ulid>
    attachment_id TEXT NOT NULL UNIQUE,           -- One extraction per attachment
    workspace_id TEXT NOT NULL,                   -- For workspace-scoped queries

    -- Top-level extracted content (indexable)
    content_type TEXT NOT NULL,                   -- 'chart' | 'table' | 'diagram' | 'screenshot' | 'photo' | 'document' | 'other'
    summary TEXT NOT NULL,                        -- 1-2 sentence description
    full_text TEXT,                               -- All extracted text for search

    -- Structured data (type-specific)
    structured_data JSONB,                        -- Chart/table/diagram specific data

    -- Full-text search
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', COALESCE(summary, '') || ' ' || COALESCE(full_text, ''))
    ) STORED,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attachment_extractions_attachment ON attachment_extractions (attachment_id);
CREATE INDEX idx_attachment_extractions_workspace ON attachment_extractions (workspace_id);
CREATE INDEX idx_attachment_extractions_type ON attachment_extractions (content_type);
CREATE INDEX idx_attachment_extractions_search ON attachment_extractions USING GIN (search_vector);

-- Add partial index on attachments for finding pending processing
CREATE INDEX idx_attachments_processing_pending
    ON attachments (processing_status, created_at)
    WHERE processing_status = 'pending';
