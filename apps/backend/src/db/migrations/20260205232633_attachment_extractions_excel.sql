-- Add excel_metadata column to attachment_extractions
-- Stores structured metadata for Excel workbook extractions (sheet info, charts, size tiers)

ALTER TABLE attachment_extractions ADD COLUMN IF NOT EXISTS excel_metadata JSONB;
