-- Support self-activities (the user's own actions) and reaction-type activities.
--
-- is_self marks rows that represent the recipient's own activity (e.g. a message
-- they sent, a reaction they added). These rows exist so the user can see their
-- own actions in the activity feed but must not inflate unread counts or trigger
-- push notifications. They are inserted with read_at = NOW() to keep unread
-- queries cheap (a single indexed predicate).
--
-- emoji records the emoji for reaction activities so that the same actor's
-- successive reactions on the same message (e.g. 👀 then ✅) are distinct
-- rows rather than collapsing into one by the existing dedup key. For
-- non-reaction activities it stays NULL.
--
-- The dedup strategy splits by activity type:
--   * non-reaction: (user_id, message_id, activity_type, actor_id) — unchanged
--   * reaction:     (user_id, message_id, actor_id, emoji)          — per emoji
-- These are expressed as partial unique indexes so ON CONFLICT can target them.

ALTER TABLE user_activity ADD COLUMN IF NOT EXISTS is_self BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE user_activity ADD COLUMN IF NOT EXISTS emoji TEXT;

-- Partial index for the Mine feed (self rows only)
CREATE INDEX IF NOT EXISTS idx_user_activity_mine
  ON user_activity (user_id, workspace_id, created_at DESC)
  WHERE is_self = TRUE;

-- Replace the single dedup index with activity-type-aware variants.
DROP INDEX IF EXISTS idx_user_activity_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_activity_dedup_non_reaction
  ON user_activity (user_id, message_id, activity_type, actor_id)
  WHERE activity_type <> 'reaction';

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_activity_dedup_reaction
  ON user_activity (user_id, message_id, actor_id, emoji)
  WHERE activity_type = 'reaction';
