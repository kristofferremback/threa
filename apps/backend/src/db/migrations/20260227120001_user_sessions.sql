-- Per-device session tracking for push notification suppression.
-- A "session" represents an active socket connection with periodic heartbeats.
CREATE TABLE IF NOT EXISTS user_sessions (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  device_key     TEXT NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, device_key)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_active
  ON user_sessions (workspace_id, user_id, last_active_at DESC);
