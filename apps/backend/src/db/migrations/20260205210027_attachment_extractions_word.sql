-- Add word-specific metadata column to attachment_extractions
-- Allows distinguishing Word document extractions from image/PDF/text extractions

-- Word-specific metadata (null for images, PDFs, and text files)
-- Schema: { format, sizeTier, injectionStrategy, pageCount, wordCount, characterCount, author, createdAt, modifiedAt, embeddedImageCount, sections }
ALTER TABLE attachment_extractions ADD COLUMN word_metadata JSONB;
