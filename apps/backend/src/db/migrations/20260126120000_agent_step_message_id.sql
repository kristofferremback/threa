-- =============================================================================
-- Add message_id to agent_session_steps for linking steps to sent messages
-- =============================================================================

ALTER TABLE agent_session_steps
    ADD COLUMN message_id TEXT;
