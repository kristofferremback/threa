-- Migrate api_key_channel_access to bot_channel_access.
-- The old table was keyed on WorkOS api_key_id (now removed).
-- The new table is keyed on bot_id for bot stream access grants.

DROP TABLE IF EXISTS api_key_channel_access;

CREATE TABLE bot_channel_access (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, bot_id, stream_id)
);

CREATE INDEX idx_bot_channel_access_bot ON bot_channel_access (workspace_id, bot_id);
