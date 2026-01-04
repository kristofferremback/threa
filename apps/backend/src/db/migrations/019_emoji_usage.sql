-- =============================================================================
-- Emoji Usage Tracking
-- Tracks which emojis each workspace member uses for personalized emoji ordering
-- =============================================================================

CREATE TABLE emoji_usage (
    id TEXT PRIMARY KEY,  -- emoji_usage_<ulid>
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    interaction_type TEXT NOT NULL,  -- 'message' | 'message_reaction'
    shortcode TEXT NOT NULL,
    occurrence_count INT NOT NULL DEFAULT 1,  -- Count of this emoji in a single message/reaction
    source_id TEXT NOT NULL,  -- message_id for traceability
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for computing emoji weights (recent 100 per user/type)
-- INCLUDE clause keeps shortcode and occurrence_count in the index for covering queries
CREATE INDEX idx_emoji_usage_weights
    ON emoji_usage (workspace_id, user_id, interaction_type, created_at DESC)
    INCLUDE (shortcode, occurrence_count);
