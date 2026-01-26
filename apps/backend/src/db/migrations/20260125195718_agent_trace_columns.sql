-- =============================================================================
-- Add columns for agent trace visibility
-- =============================================================================

-- Add sources column to store step sources (web links, workspace references)
ALTER TABLE agent_session_steps
    ADD COLUMN sources JSONB;

-- Add current_step_type to agent_sessions for efficient cross-stream queries
-- When a thread session is running, we need to show "Ariadne is thinking..."
-- on the parent message. This column enables querying active sessions.
ALTER TABLE agent_sessions
    ADD COLUMN current_step_type TEXT;
