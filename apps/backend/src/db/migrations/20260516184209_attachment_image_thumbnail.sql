-- Add image thumbnail variant + intrinsic dimensions to attachments.
--
-- A background sharp worker resizes uploaded images into a small WebP
-- thumbnail served as ?variant=thumbnail in the stream view (the full-size
-- original is still served to the gallery/lightbox). width/height record the
-- original orientation-corrected pixel dimensions so the frontend can reserve
-- the image box before any bytes arrive — no layout shift, no progressive
-- side-reveal. All three are nullable: they stay NULL until the worker runs
-- and remain NULL for non-image / SVG attachments.

ALTER TABLE attachments
    ADD COLUMN IF NOT EXISTS thumbnail_storage_path TEXT,
    ADD COLUMN IF NOT EXISTS width INTEGER,
    ADD COLUMN IF NOT EXISTS height INTEGER;
