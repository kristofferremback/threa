-- Researcher cache for storing pre-computed research results per message
-- Isolated table for easy iteration on the researcher feature

CREATE TABLE researcher_cache (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  stream_id TEXT NOT NULL,
  access_spec JSONB NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Fast lookup by message ID (most common query)
CREATE INDEX idx_researcher_cache_message_id ON researcher_cache(message_id);

-- For cleanup of expired entries
CREATE INDEX idx_researcher_cache_expires_at ON researcher_cache(expires_at);

-- For workspace-scoped queries if needed
CREATE INDEX idx_researcher_cache_workspace_id ON researcher_cache(workspace_id);
