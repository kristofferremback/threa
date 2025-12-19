-- =============================================================================
-- Agent Sessions: Track last seen message sequence
-- =============================================================================
-- Enables tracking which messages an agent session has "seen" to prevent
-- re-triggering for messages that were processed but not responded to.

ALTER TABLE agent_sessions
    ADD COLUMN last_seen_sequence BIGINT;

-- Index for finding sessions by stream ordered by recency (for finding latest session)
CREATE INDEX idx_agent_sessions_stream_created
    ON agent_sessions (stream_id, created_at DESC);
