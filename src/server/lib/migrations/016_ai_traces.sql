-- ============================================================================
-- AI Traces Migration
-- ============================================================================
-- Adds: ai_traces table for observability into AI operations
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_traces (
    id TEXT PRIMARY KEY,

    -- Trace hierarchy
    trace_id TEXT NOT NULL,           -- Groups related spans (e.g., one user request)
    parent_span_id TEXT,              -- For nested spans (e.g., agent -> tool call)

    -- Identity
    workspace_id TEXT,
    user_id TEXT,

    -- Operation details
    operation TEXT NOT NULL,          -- 'ollama.classify', 'ollama.embed', 'anthropic.chat', 'agent.invoke', etc.
    model TEXT,                        -- Model name/ID
    provider TEXT NOT NULL,           -- 'ollama', 'anthropic', 'openai', 'langchain'

    -- Timing
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_ms INT,                  -- Computed on end

    -- Status
    status TEXT NOT NULL DEFAULT 'running',  -- 'running', 'success', 'error'
    error_message TEXT,
    error_code TEXT,

    -- Token usage (when applicable)
    input_tokens INT,
    output_tokens INT,

    -- Input/Output capture (truncated for storage)
    input_preview TEXT,               -- First N chars of input
    output_preview TEXT,              -- First N chars of output

    -- Context references
    stream_id TEXT,
    event_id TEXT,
    job_id TEXT,

    -- Detailed data for debugging
    metadata JSONB DEFAULT '{}',      -- Tool calls, intermediate steps, etc.

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for finding traces by trace_id (grouping related spans)
CREATE INDEX IF NOT EXISTS idx_ai_traces_trace_id ON ai_traces(trace_id);

-- Index for workspace-level analysis
CREATE INDEX IF NOT EXISTS idx_ai_traces_workspace_created
    ON ai_traces(workspace_id, created_at DESC)
    WHERE workspace_id IS NOT NULL;

-- Index for finding traces by operation type
CREATE INDEX IF NOT EXISTS idx_ai_traces_operation_created
    ON ai_traces(operation, created_at DESC);

-- Index for finding error traces
CREATE INDEX IF NOT EXISTS idx_ai_traces_errors
    ON ai_traces(status, created_at DESC)
    WHERE status = 'error';

-- Index for finding slow traces
CREATE INDEX IF NOT EXISTS idx_ai_traces_duration
    ON ai_traces(duration_ms DESC, created_at DESC)
    WHERE duration_ms IS NOT NULL;

-- Index for parent-child relationships
CREATE INDEX IF NOT EXISTS idx_ai_traces_parent
    ON ai_traces(parent_span_id)
    WHERE parent_span_id IS NOT NULL;

-- Index for stream/event correlation
CREATE INDEX IF NOT EXISTS idx_ai_traces_stream ON ai_traces(stream_id) WHERE stream_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_traces_event ON ai_traces(event_id) WHERE event_id IS NOT NULL;

COMMENT ON TABLE ai_traces IS 'Observability traces for AI operations (Ollama, Anthropic, OpenAI, LangChain)';
COMMENT ON COLUMN ai_traces.trace_id IS 'Groups related spans into a single trace (e.g., user question -> agent -> tools)';
COMMENT ON COLUMN ai_traces.parent_span_id IS 'Links child spans to parent (e.g., tool call to agent invocation)';
COMMENT ON COLUMN ai_traces.operation IS 'Identifies the specific operation: ollama.classify, anthropic.chat, agent.invoke, etc.';
COMMENT ON COLUMN ai_traces.input_preview IS 'First ~500 chars of input for quick inspection';
COMMENT ON COLUMN ai_traces.output_preview IS 'First ~500 chars of output for quick inspection';
COMMENT ON COLUMN ai_traces.metadata IS 'JSON with tool calls, intermediate steps, full prompts (if needed), etc.';
