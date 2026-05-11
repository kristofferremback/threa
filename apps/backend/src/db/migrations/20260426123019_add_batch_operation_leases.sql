-- Batch operation leases
-- Requires destructive or multi-step batch operations to be validated before commit.

CREATE TABLE IF NOT EXISTS batch_operation_leases (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_batch_operation_leases_lookup
    ON batch_operation_leases (workspace_id, user_id, operation_type, expires_at)
    WHERE consumed_at IS NULL;
