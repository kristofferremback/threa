-- =============================================================================
-- Display Names: Simplify stream naming model
-- =============================================================================
-- - Channels: use slug as display name (no separate name field)
-- - Scratchpads/Threads: auto-generated display names from conversation content
-- - DMs: computed from participant names at query time

-- Rename name -> display_name for clarity
ALTER TABLE streams RENAME COLUMN name TO display_name;

-- Track when display name was auto-generated (NULL = not yet generated)
-- This tells us whether to attempt LLM naming on new messages
ALTER TABLE streams ADD COLUMN display_name_generated_at TIMESTAMPTZ;

-- Update the search vector to use display_name instead of name
-- Drop and recreate since generated columns can't be altered directly
ALTER TABLE streams DROP COLUMN search_vector;
ALTER TABLE streams ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', COALESCE(display_name, '') || ' ' || COALESCE(description, ''))
) STORED;

-- Recreate the search index
DROP INDEX IF EXISTS idx_streams_search;
CREATE INDEX idx_streams_search ON streams USING GIN (search_vector)
    WHERE archived_at IS NULL;
