-- Store sparse workspace overrides for code-backed built-in agent configuration.
-- Built-in defaults live in application code; rows here only patch values that
-- differ for a workspace.

CREATE TABLE IF NOT EXISTS agent_config_overrides (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    patch JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_config_overrides_workspace_active
    ON agent_config_overrides (workspace_id, agent_id)
    WHERE status = 'active';

-- Ariadne is now resolved from the code-backed built-in registry. Keep the
-- historical row non-active so old databases no longer source defaults from it.
UPDATE personas
SET status = 'archived',
    updated_at = NOW()
WHERE id = 'persona_system_ariadne';
