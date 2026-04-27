-- Add durable general research workflow state.
-- Runs and steps are workspace-scoped checkpoints so redeploys can resume
-- completed phases and only redo the most recent in-flight prompt or call.

CREATE TABLE IF NOT EXISTS general_research_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    agent_session_id TEXT NOT NULL,
    invocation_key TEXT NOT NULL,
    tool_call_id TEXT,
    query TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    current_phase TEXT NOT NULL,
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    attempt INTEGER NOT NULL DEFAULT 0,
    partial_reason TEXT,
    final_answer TEXT,
    report_storage_key TEXT,
    output_json JSONB,
    sources_json JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (agent_session_id, invocation_key)
);

CREATE INDEX IF NOT EXISTS idx_general_research_runs_workspace_status
    ON general_research_runs (workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_general_research_runs_recovery
    ON general_research_runs (status, lease_expires_at)
    WHERE status IN ('running', 'pending');

CREATE TABLE IF NOT EXISTS general_research_steps (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_key TEXT NOT NULL,
    phase TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    input_json JSONB,
    output_json JSONB,
    sources_json JSONB NOT NULL DEFAULT '[]',
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_general_research_steps_run
    ON general_research_steps (run_id, started_at);

-- Built-in tool enablement for Ariadne lives in apps/backend/src/features/agents/built-in-agents.ts
-- (code-backed defaults). Workspace-managed personas can add `general_research` via their row or
-- an agent_config_overrides patch if product policy allows.
