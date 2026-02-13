-- Activity feed for mentions, replies, and reactions
-- Projection table (INV-7) with per-member read state for fast unread counts and pagination

CREATE TABLE IF NOT EXISTS member_activity (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feed query: unread items for a member, newest first
CREATE INDEX IF NOT EXISTS idx_member_activity_feed
  ON member_activity (member_id, workspace_id, created_at DESC);

-- Unread count per stream (for sidebar mention badges)
CREATE INDEX IF NOT EXISTS idx_member_activity_unread_by_stream
  ON member_activity (member_id, workspace_id, stream_id)
  WHERE read_at IS NULL;

-- Idempotency: prevent duplicate activity for same mention in same message
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_activity_dedup
  ON member_activity (member_id, message_id, activity_type, actor_id);
