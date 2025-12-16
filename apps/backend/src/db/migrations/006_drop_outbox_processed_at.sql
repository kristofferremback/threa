-- =============================================================================
-- Remove processed_at from outbox table
-- No longer needed with per-listener cursor tracking
-- =============================================================================

-- Drop the index that depends on processed_at
DROP INDEX IF EXISTS idx_outbox_unprocessed;

-- Remove the processed_at column
ALTER TABLE outbox DROP COLUMN IF EXISTS processed_at;
