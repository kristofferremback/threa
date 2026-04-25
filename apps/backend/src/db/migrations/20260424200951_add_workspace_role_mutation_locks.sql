-- Serialize WorkOS role mutations without holding a DB connection open while
-- waiting on the external WorkOS API call.

CREATE TABLE IF NOT EXISTS workspace_role_mutation_locks (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    lock_run_id TEXT NOT NULL,
    locked_until TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_role_mutation_locks_until
    ON workspace_role_mutation_locks(locked_until);
