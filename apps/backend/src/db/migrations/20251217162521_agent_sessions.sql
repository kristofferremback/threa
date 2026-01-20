-- =============================================================================
-- Agent Sessions: Durable tracking for agentic companion responses
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Agent Sessions: One row per companion invocation
-- Enables durability and recovery for long-running agent work
-- -----------------------------------------------------------------------------
CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,                    -- session_<ulid>
    stream_id TEXT NOT NULL,
    persona_id TEXT NOT NULL,
    trigger_message_id TEXT NOT NULL,       -- Message that triggered this session

    status TEXT NOT NULL,                   -- 'pending' | 'running' | 'completed' | 'failed'
    current_step INTEGER NOT NULL DEFAULT 0,

    -- For recovery: track which server is handling and when it last checked in
    server_id TEXT,                         -- Which server instance is handling this
    heartbeat_at TIMESTAMPTZ,

    -- Results
    response_message_id TEXT,               -- Message ID of the response (if completed)
    error TEXT,                             -- Error message (if failed)

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Index for finding sessions by stream (for debugging/inspection)
CREATE INDEX idx_agent_sessions_stream ON agent_sessions (stream_id);

-- Index for finding orphaned sessions (running but stale heartbeat)
CREATE INDEX idx_agent_sessions_orphan
    ON agent_sessions (status, heartbeat_at)
    WHERE status = 'running';

-- -----------------------------------------------------------------------------
-- Agent Session Steps: Checkpoints for recovery and audit trail
-- Each step in the agent loop is recorded for debugging and resumption
-- -----------------------------------------------------------------------------
CREATE TABLE agent_session_steps (
    id TEXT PRIMARY KEY,                    -- step_<ulid>
    session_id TEXT NOT NULL,
    step_number INTEGER NOT NULL,
    step_type TEXT NOT NULL,                -- 'thinking' | 'tool_call' | 'tool_result' | 'response'
    content JSONB,                          -- Step-specific data
    tokens_used INTEGER,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,

    UNIQUE (session_id, step_number)
);

-- Index for fetching steps by session
CREATE INDEX idx_agent_session_steps_session ON agent_session_steps (session_id, step_number);
