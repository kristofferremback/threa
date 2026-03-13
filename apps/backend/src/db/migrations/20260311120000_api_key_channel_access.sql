-- API key channel access grants for public API
-- Tracks which private channels an API key can access
CREATE TABLE api_key_channel_access (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  api_key_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, api_key_id, stream_id)
);

CREATE INDEX idx_api_key_channel_access_key
  ON api_key_channel_access (workspace_id, api_key_id);
