-- Create pdf_page_extractions table for storing page-level PDF content
-- Part of the fan-out/fan-in PDF processing pipeline

CREATE TABLE pdf_page_extractions (
    id TEXT PRIMARY KEY,                          -- pdfpage_<ulid>
    attachment_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,                 -- 1-indexed

    -- Page classification determines processing strategy
    classification TEXT NOT NULL,                 -- text_rich | scanned | complex_layout | mixed | empty

    -- Extracted content (mutually exclusive based on classification)
    raw_text TEXT,                                -- Direct extraction from PDF (text_rich pages)
    ocr_text TEXT,                                -- Tesseract result for scanned pages
    markdown_content TEXT,                        -- Gemini result for complex layouts

    -- Embedded images within the page
    embedded_images JSONB,                        -- [{id, storagePath, caption}]

    -- Processing status for individual page
    processing_status TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | completed | failed
    error_message TEXT,

    -- Full-text search across all text content
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english',
            COALESCE(raw_text, '') || ' ' ||
            COALESCE(ocr_text, '') || ' ' ||
            COALESCE(markdown_content, '')
        )
    ) STORED,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One extraction per page per attachment
    UNIQUE (attachment_id, page_number)
);

-- Index for looking up pages by attachment
CREATE INDEX idx_pdf_page_extractions_attachment ON pdf_page_extractions (attachment_id);

-- Index for workspace-scoped queries
CREATE INDEX idx_pdf_page_extractions_workspace ON pdf_page_extractions (workspace_id);

-- Index for finding pages needing processing
CREATE INDEX idx_pdf_page_extractions_pending
    ON pdf_page_extractions (attachment_id, processing_status)
    WHERE processing_status IN ('pending', 'processing');

-- Full-text search index
CREATE INDEX idx_pdf_page_extractions_search ON pdf_page_extractions USING GIN (search_vector);
