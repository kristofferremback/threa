-- Bot customization: make bots first-class entities with rich profiles and self-managed API keys.
-- Bots become primary entities that admins create/customize; keys are their auth credentials.

-- Evolve bots table: add slug, avatar_url, archived_at; make api_key_id nullable
ALTER TABLE bots ADD COLUMN slug TEXT;
ALTER TABLE bots ADD COLUMN avatar_url TEXT;
ALTER TABLE bots ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE bots ALTER COLUMN api_key_id DROP NOT NULL;

-- Unique slug per workspace among non-archived bots
CREATE UNIQUE INDEX idx_bots_workspace_slug ON bots (workspace_id, slug) WHERE archived_at IS NULL;

-- Self-managed bot API keys (mirrors user_api_keys structure + bot_id)
CREATE TABLE bot_api_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bot_api_keys_bot ON bot_api_keys (workspace_id, bot_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_bot_api_keys_prefix ON bot_api_keys (key_prefix) WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW());
