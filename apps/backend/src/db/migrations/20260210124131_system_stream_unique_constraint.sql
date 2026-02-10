-- Ensures one system stream per member per workspace.
-- Enables idempotent provisioning via INSERT ... ON CONFLICT DO NOTHING
-- (same pattern as idx_streams_thread_parent for threads).

CREATE UNIQUE INDEX IF NOT EXISTS idx_streams_system_per_member
ON streams (workspace_id, created_by)
WHERE type = 'system';
