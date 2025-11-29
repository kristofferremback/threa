-- Agent Sessions - Track AI reasoning steps with persistence
-- Enables resume on failure, inline display in chat, and summarization

CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stream_id TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  triggering_event_id TEXT NOT NULL REFERENCES stream_events(id) ON DELETE CASCADE,
  response_event_id TEXT REFERENCES stream_events(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'summarizing', 'completed', 'failed')),

  -- Steps stored as JSONB array for flexibility
  -- Each step: { id, type, content, tool_name?, tool_input?, tool_result?, started_at, completed_at?, status }
  steps JSONB NOT NULL DEFAULT '[]',

  summary TEXT,
  error_message TEXT,

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Find sessions by stream (for loading with events)
CREATE INDEX idx_agent_sessions_stream ON agent_sessions(stream_id, created_at DESC);

-- Find active sessions (for resume on restart)
CREATE INDEX idx_agent_sessions_active ON agent_sessions(status) WHERE status = 'active';

-- Find session by triggering event (for deduplication and linking)
CREATE INDEX idx_agent_sessions_triggering ON agent_sessions(triggering_event_id);

-- Find session by response event (for UI linking)
CREATE INDEX idx_agent_sessions_response ON agent_sessions(response_event_id) WHERE response_event_id IS NOT NULL;

-- Workspace-level queries (analytics, cleanup)
CREATE INDEX idx_agent_sessions_workspace ON agent_sessions(workspace_id, created_at DESC);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_agent_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_sessions_updated_at
  BEFORE UPDATE ON agent_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_sessions_updated_at();
