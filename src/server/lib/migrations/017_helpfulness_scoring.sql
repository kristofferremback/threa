-- Add helpfulness scoring columns to agent_sessions
-- Used to track Ariadne's effectiveness over time

ALTER TABLE agent_sessions
  ADD COLUMN helpfulness_score INTEGER,
  ADD COLUMN helpfulness_reasoning TEXT;

-- Index for analytics queries on helpfulness
CREATE INDEX idx_agent_sessions_helpfulness
  ON agent_sessions(workspace_id, helpfulness_score, created_at DESC)
  WHERE helpfulness_score IS NOT NULL;
