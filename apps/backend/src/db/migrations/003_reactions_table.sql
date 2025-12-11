-- =============================================================================
-- Reactions Table: Separate table to fix race condition in JSONB updates
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Reactions: Normalized storage for message reactions
-- -----------------------------------------------------------------------------
CREATE TABLE reactions (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message ON reactions (message_id);

-- -----------------------------------------------------------------------------
-- Migrate existing data from messages.reactions JSONB
-- -----------------------------------------------------------------------------
INSERT INTO reactions (message_id, user_id, emoji, created_at)
SELECT
    m.id as message_id,
    user_id::text,
    emoji,
    m.created_at
FROM messages m,
     jsonb_each(COALESCE(m.reactions, '{}'::jsonb)) AS emoji_users(emoji, user_ids),
     jsonb_array_elements_text(user_ids) AS user_id
WHERE m.reactions IS NOT NULL AND m.reactions != '{}'::jsonb
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Remove reactions column from messages (keep as computed for now)
-- We'll remove this in a future migration after verifying the change works
-- -----------------------------------------------------------------------------
-- For now, we keep the column but it's no longer the source of truth.
-- The repository will aggregate from the reactions table.
