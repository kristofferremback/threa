-- Add GIN indexes for trigram-based fuzzy search on stream display_name and slug
CREATE INDEX IF NOT EXISTS idx_streams_display_name_trgm ON streams USING GIN (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_streams_slug_trgm ON streams USING GIN (slug gin_trgm_ops);
