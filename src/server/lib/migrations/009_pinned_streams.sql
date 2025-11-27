-- ============================================================================
-- Add pinned_at to stream_members for pinned channels feature
-- ============================================================================

ALTER TABLE stream_members
ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

COMMENT ON COLUMN stream_members.pinned_at IS 'When the user pinned this stream (NULL = not pinned)';

CREATE INDEX IF NOT EXISTS idx_stream_members_pinned
    ON stream_members(user_id, pinned_at)
    WHERE pinned_at IS NOT NULL AND left_at IS NULL;

