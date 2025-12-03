-- Agent Personas - User-configurable AI agent personalities
-- Inspired by Anthropic's Agent Skills pattern with progressive disclosure

CREATE TABLE agent_personas (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Level 1: Metadata (always shown in UI, used for agent selection)
  name TEXT NOT NULL,
  slug TEXT NOT NULL, -- for @mention (e.g., @support-agent)
  description TEXT NOT NULL, -- explains when/how to use this persona
  avatar_emoji TEXT, -- optional visual identifier (e.g., 🛠️)

  -- Level 2: Instructions (loaded when persona is invoked)
  system_prompt TEXT NOT NULL, -- main persona instructions/personality

  -- Tool configuration
  -- Array of tool names to enable (NULL = all tools enabled)
  enabled_tools TEXT[],

  -- Model configuration (using provider:model format)
  model TEXT NOT NULL DEFAULT 'anthropic:claude-haiku-4-5-20251001',
  temperature REAL NOT NULL DEFAULT 0.7
    CHECK (temperature >= 0 AND temperature <= 2),
  max_tokens INTEGER NOT NULL DEFAULT 2048
    CHECK (max_tokens > 0 AND max_tokens <= 128000),

  -- Scope constraints
  -- NULL means persona is available in all channels
  allowed_stream_ids TEXT[],

  -- Whether this is the default persona for the workspace (only one can be default)
  is_default BOOLEAN NOT NULL DEFAULT FALSE,

  -- Visibility
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  -- Audit
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  UNIQUE(workspace_id, slug)
);

-- Unique partial index: only one default persona per workspace
CREATE UNIQUE INDEX idx_agent_personas_default
  ON agent_personas(workspace_id)
  WHERE is_default = TRUE;

-- Find personas for a workspace
CREATE INDEX idx_agent_personas_workspace
  ON agent_personas(workspace_id, is_active, name);

-- Find persona by slug (for @mention resolution)
CREATE INDEX idx_agent_personas_slug
  ON agent_personas(workspace_id, slug)
  WHERE is_active = TRUE;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_agent_personas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_personas_updated_at
  BEFORE UPDATE ON agent_personas
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_personas_updated_at();

-- Insert the default Ariadne persona for existing workspaces
-- This preserves backward compatibility while enabling custom personas
INSERT INTO agent_personas (
  id,
  workspace_id,
  name,
  slug,
  description,
  avatar_emoji,
  system_prompt,
  enabled_tools,
  model,
  temperature,
  max_tokens,
  is_default,
  created_by
)
SELECT
  'pers_ariadne_' || REPLACE(id, 'ws_', ''),
  id,
  'Ariadne',
  'ariadne',
  'Knowledgeable AI assistant that helps navigate workspace knowledge. Searches memos, messages, and the web to answer questions.',
  '🧵',
  'You are Ariadne, a knowledgeable AI assistant for this workspace. Your name comes from Greek mythology - Ariadne gave Theseus the thread that guided him through the labyrinth. You help people navigate their organization''s knowledge and find what they need.',
  NULL, -- all tools enabled
  'anthropic:claude-haiku-4-5-20251001',
  0.7,
  2048,
  TRUE,
  (SELECT id FROM users LIMIT 1)
FROM workspaces;
