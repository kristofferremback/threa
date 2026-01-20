-- Replace partial unique index with full unique constraint
-- Allows atomic INSERT ... ON CONFLICT for schedule upserts

-- Drop partial index (only prevents duplicates for enabled=true)
DROP INDEX idx_cron_schedules_queue_workspace;

-- Create full unique constraint (prevents all duplicates)
-- One schedule per (queue, workspace) pair, regardless of enabled state
ALTER TABLE cron_schedules
  ADD CONSTRAINT cron_schedules_queue_workspace_key
  UNIQUE (queue_name, workspace_id);
