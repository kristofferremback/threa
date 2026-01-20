-- =============================================================================
-- Agent Sessions: Track sent message IDs
-- =============================================================================
-- Stores all message IDs sent by the agent during a session.
-- Provides a strong link from session -> messages for crash recovery and auditing.

ALTER TABLE agent_sessions
    ADD COLUMN sent_message_ids TEXT[] DEFAULT '{}';
