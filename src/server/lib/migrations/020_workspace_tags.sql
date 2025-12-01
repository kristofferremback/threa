-- ============================================================================
-- Workspace Tags - Organic tagging system for memos
-- ============================================================================
-- Tags grow organically as content is classified. The LLM is given existing
-- tags as context and can either reuse them or suggest new ones.

CREATE TABLE workspace_tags (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Tag name (lowercase, normalized)
  name TEXT NOT NULL,

  -- Usage tracking
  usage_count INTEGER DEFAULT 1,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(workspace_id, name)
);

-- Index for fetching popular tags
CREATE INDEX idx_workspace_tags_popular ON workspace_tags(workspace_id, usage_count DESC);

COMMENT ON TABLE workspace_tags IS 'Organic tags for memos - grow over time as content is classified';
COMMENT ON COLUMN workspace_tags.usage_count IS 'How many times this tag has been applied';
