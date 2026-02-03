-- Drop redundant index on attachment_extractions.attachment_id
-- The UNIQUE constraint on line 6 of the original migration already creates an implicit index
DROP INDEX IF EXISTS idx_attachment_extractions_attachment;
