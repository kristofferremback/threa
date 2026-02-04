-- Add PDF-specific columns to attachment_extractions
-- Allows distinguishing image extractions from PDF document extractions

-- Source type: image (existing) or pdf (new)
ALTER TABLE attachment_extractions ADD COLUMN source_type TEXT NOT NULL DEFAULT 'image';

-- PDF-specific metadata (null for images)
-- Schema: { totalPages, sizeTier, sections: [{startPage, endPage, title}] }
ALTER TABLE attachment_extractions ADD COLUMN pdf_metadata JSONB;

-- Index for filtering by source type
CREATE INDEX idx_attachment_extractions_source_type ON attachment_extractions (source_type);
