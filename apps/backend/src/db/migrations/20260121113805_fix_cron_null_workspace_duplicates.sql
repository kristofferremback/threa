-- Fix unique constraint to treat NULL workspace_id as equal
-- Prevents duplicate schedules with workspace_id=NULL
--
-- Problem: UNIQUE (queue_name, workspace_id) allows multiple NULLs
-- because NULL != NULL in SQL. This caused duplicate schedules to be
-- created on every server restart when workspace_id was NULL.
--
-- Solution: Add NULLS NOT DISTINCT to treat NULLs as equal

-- Drop existing constraint
ALTER TABLE cron_schedules
  DROP CONSTRAINT cron_schedules_queue_workspace_key;

-- Recreate with NULLS NOT DISTINCT
ALTER TABLE cron_schedules
  ADD CONSTRAINT cron_schedules_queue_workspace_key
  UNIQUE NULLS NOT DISTINCT (queue_name, workspace_id);
