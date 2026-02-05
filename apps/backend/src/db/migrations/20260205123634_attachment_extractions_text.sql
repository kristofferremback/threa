-- Add text-specific metadata column to attachment_extractions
-- Allows distinguishing text file extractions from image/PDF extractions

-- Text-specific metadata (null for images and PDFs)
-- Schema: { format, sizeTier, injectionStrategy, totalLines, totalBytes, encoding, sections, structure }
ALTER TABLE attachment_extractions ADD COLUMN text_metadata JSONB;
