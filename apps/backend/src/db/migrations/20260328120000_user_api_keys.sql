-- User-scoped API keys: owned by individual users, inherit user's stream access.
-- Unlike workspace-scoped WorkOS keys, these are managed by Threa directly.
CREATE TABLE user_api_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_api_keys_workspace_user
  ON user_api_keys (workspace_id, user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_user_api_keys_prefix
  ON user_api_keys (key_prefix)
  WHERE revoked_at IS NULL;

-- Track when a message was sent via an API key (user-scoped).
-- NULL for normal user/persona/system messages.
ALTER TABLE messages ADD COLUMN sent_via TEXT;
