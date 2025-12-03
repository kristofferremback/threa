-- Allow stream events to be posted by AI agents (not just users)
-- agent_id references ai_personas table

ALTER TABLE stream_events ADD COLUMN IF NOT EXISTS agent_id TEXT REFERENCES ai_personas(id);

-- Make actor_id nullable (can be null when agent_id is set)
ALTER TABLE stream_events ALTER COLUMN actor_id DROP NOT NULL;

-- Add constraint: either actor_id or agent_id must be set
ALTER TABLE stream_events ADD CONSTRAINT chk_actor_or_agent
  CHECK (actor_id IS NOT NULL OR agent_id IS NOT NULL);

-- Index for agent events
CREATE INDEX IF NOT EXISTS idx_stream_events_agent ON stream_events(agent_id) WHERE agent_id IS NOT NULL;

COMMENT ON COLUMN stream_events.agent_id IS 'AI agent/persona that created this event (mutually exclusive with actor_id for agent-generated content)';




