-- Persona Versions - Track draft state and version history for agent personas
-- Supports: draft editing without affecting live persona, rollback to previous versions

-- Version history table stores snapshots of persona configurations
CREATE TABLE persona_versions (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL REFERENCES agent_personas(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,

  -- Snapshot of persona config at this version
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL,
  avatar_emoji TEXT,
  system_prompt TEXT NOT NULL,
  enabled_tools TEXT[],
  model TEXT NOT NULL,
  temperature REAL NOT NULL,
  max_tokens INTEGER NOT NULL,
  allowed_stream_ids TEXT[],

  -- Version metadata
  is_published BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE = this version is/was live
  published_at TIMESTAMPTZ, -- When this version was published (made live)
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraint: version numbers are unique per persona
  UNIQUE(persona_id, version_number)
);

-- Add columns to agent_personas for draft/version tracking
ALTER TABLE agent_personas ADD COLUMN IF NOT EXISTS current_version_id TEXT REFERENCES persona_versions(id);
ALTER TABLE agent_personas ADD COLUMN IF NOT EXISTS draft_version_id TEXT REFERENCES persona_versions(id);
ALTER TABLE agent_personas ADD COLUMN IF NOT EXISTS latest_version_number INTEGER NOT NULL DEFAULT 0;

-- Index for finding versions of a persona
CREATE INDEX idx_persona_versions_persona ON persona_versions(persona_id, version_number DESC);

-- Index for finding published versions
CREATE INDEX idx_persona_versions_published ON persona_versions(persona_id, is_published, published_at DESC);

-- Draft state storage (stored separately to avoid polluting the versions table with auto-saves)
CREATE TABLE persona_drafts (
  id TEXT PRIMARY KEY,
  persona_id TEXT REFERENCES agent_personas(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Draft data (mirrors persona structure, can be partial)
  name TEXT,
  slug TEXT,
  description TEXT,
  avatar_emoji TEXT,
  system_prompt TEXT,
  enabled_tools TEXT[],
  model TEXT,
  temperature REAL,
  max_tokens INTEGER,
  allowed_stream_ids TEXT[],

  -- For new personas being created (persona_id is null)
  is_new_persona BOOLEAN NOT NULL DEFAULT FALSE,

  -- Test stream association (for test chat)
  test_stream_id TEXT REFERENCES streams(id) ON DELETE SET NULL,

  -- Tracking
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One draft per persona per user (or one "new" draft per user per workspace)
  UNIQUE(persona_id, user_id),
  UNIQUE(workspace_id, user_id, is_new_persona) -- Only one "new" draft per user
);

-- Index for finding drafts
CREATE INDEX idx_persona_drafts_user ON persona_drafts(user_id, updated_at DESC);
CREATE INDEX idx_persona_drafts_workspace ON persona_drafts(workspace_id, user_id);

-- Trigger to update updated_at on persona_drafts
CREATE OR REPLACE FUNCTION update_persona_drafts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER persona_drafts_updated_at
  BEFORE UPDATE ON persona_drafts
  FOR EACH ROW
  EXECUTE FUNCTION update_persona_drafts_updated_at();
