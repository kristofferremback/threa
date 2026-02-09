-- =============================================================================
-- Agent Conversation Summaries
-- =============================================================================
-- Stores rolling summaries of older messages dropped from active agent context.
-- One row per (stream, persona), updated incrementally as context window slides.

CREATE TABLE IF NOT EXISTS agent_conversation_summaries (
    id TEXT PRIMARY KEY,                           -- agsum_<ulid>
    workspace_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    persona_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    last_summarized_sequence BIGINT NOT NULL,      -- Highest sequence included in summary
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_conversation_summaries_stream_persona
    ON agent_conversation_summaries (stream_id, persona_id);

CREATE INDEX IF NOT EXISTS idx_agent_conversation_summaries_workspace_stream
    ON agent_conversation_summaries (workspace_id, stream_id);
