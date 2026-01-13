-- =============================================================================
-- Message Content: ProseMirror JSON as Primary Format
-- =============================================================================
-- Changes message storage from Markdown (TEXT) to ProseMirror JSON (JSONB).
-- - content → content_markdown (rename, kept for search/AI)
-- - content_format → dropped (no longer needed)
-- - content_json → added (primary storage)
-- - search_vector updated to use content_markdown

-- 1. Rename content column to content_markdown
ALTER TABLE messages RENAME COLUMN content TO content_markdown;

-- 2. Add content_json column (JSONB for ProseMirror document)
-- Initially allow NULL so existing rows don't break, then we'll make NOT NULL
ALTER TABLE messages ADD COLUMN content_json JSONB;

-- 3. Populate content_json for existing messages with a simple doc wrapper
-- This creates a minimal valid ProseMirror document from the markdown text
UPDATE messages SET content_json = jsonb_build_object(
    'type', 'doc',
    'content', jsonb_build_array(
        jsonb_build_object(
            'type', 'paragraph',
            'content', jsonb_build_array(
                jsonb_build_object('type', 'text', 'text', content_markdown)
            )
        )
    )
) WHERE content_json IS NULL;

-- 4. Make content_json NOT NULL now that all rows have values
ALTER TABLE messages ALTER COLUMN content_json SET NOT NULL;

-- 5. Drop content_format column (no longer needed)
ALTER TABLE messages DROP COLUMN content_format;

-- 6. Recreate search_vector as it references the renamed column
-- First drop the generated column, then recreate it
ALTER TABLE messages DROP COLUMN search_vector;
ALTER TABLE messages ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', content_markdown)
) STORED;

-- 7. Recreate the search index on the new column
DROP INDEX IF EXISTS idx_messages_search;
CREATE INDEX idx_messages_search ON messages USING GIN (search_vector)
    WHERE deleted_at IS NULL;

-- 8. Update event comments to reflect new schema
-- Event types now use:
-- 'message_created'    - { message_id, content_json, content_markdown, attachments? }
-- 'message_edited'     - { message_id, content_json, content_markdown, edited_at }
