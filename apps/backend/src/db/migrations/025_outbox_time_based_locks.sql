-- =============================================================================
-- Time-based cursor locking for outbox listeners
-- =============================================================================
-- Replaces row-level transaction locks with time-based locks.
-- Enables shorter DB transactions while maintaining exclusive cursor access.

ALTER TABLE outbox_listeners
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lock_run_id TEXT;

-- Index for efficient lock queries
CREATE INDEX IF NOT EXISTS idx_outbox_listeners_lock
  ON outbox_listeners (listener_id, locked_until);
