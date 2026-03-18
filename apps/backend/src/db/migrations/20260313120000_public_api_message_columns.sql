-- Bot entities for API-created messages.
-- Follows the persona pattern: authorType "bot" + authorId -> bots.id
CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  api_key_id TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_emoji TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One bot per API key per workspace
CREATE UNIQUE INDEX idx_bots_workspace_api_key ON bots (workspace_id, api_key_id);
