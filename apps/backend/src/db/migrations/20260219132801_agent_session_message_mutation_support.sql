-- =============================================================================
-- Agent session mutation support for message edits/deletions
-- =============================================================================
-- Adds metadata needed to track which invoking message revision a session used
-- and to link rerun sessions to the superseded predecessor session.

ALTER TABLE agent_sessions
    ADD COLUMN IF NOT EXISTS trigger_message_revision INTEGER;

ALTER TABLE agent_sessions
    ADD COLUMN IF NOT EXISTS supersedes_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_trigger_message_created
    ON agent_sessions (trigger_message_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_supersedes
    ON agent_sessions (supersedes_session_id);
