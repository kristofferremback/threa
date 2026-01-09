-- =============================================================================
-- Ensure only one running session per stream
-- Prevents race condition where concurrent requests both create sessions
-- =============================================================================

-- Partial unique index: only one session with status='running' per stream
-- INSERT will fail with unique violation if another running session exists
CREATE UNIQUE INDEX idx_agent_sessions_one_running_per_stream
    ON agent_sessions (stream_id)
    WHERE status = 'running';
