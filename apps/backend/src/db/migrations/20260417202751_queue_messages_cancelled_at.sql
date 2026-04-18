-- Add cancelled_at so queue message cancellation has its own column instead
-- of reusing completed_at.
--
-- Previously `QueueRepository.tombstoneById` wrote completed_at = NOW() on a
-- pending row to prevent the job from firing. That overloaded completed_at to
-- mean "completed OR cancelled" — any future analytics on completion counts
-- would silently include cancellations.
--
-- The claim hot-path index must also filter cancelled rows so workers skip
-- them, and the cleanup retention sweep needs a matching index to find old
-- cancelled rows.

ALTER TABLE queue_messages ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- Rebuild the "next available" index so cancelled rows don't show up to
-- workers. Partial indexes must be matched exactly on WHERE to be used with
-- ON CONFLICT; here the index is only consulted by claim SELECTs (no ON
-- CONFLICT) so we can safely drop + recreate with the extended predicate.
DROP INDEX IF EXISTS idx_queue_messages_available;

CREATE INDEX idx_queue_messages_available
    ON queue_messages (queue_name, workspace_id, process_after)
    WHERE dlq_at IS NULL
      AND completed_at IS NULL
      AND cancelled_at IS NULL;

-- Cleanup path for retention sweeps.
CREATE INDEX IF NOT EXISTS idx_queue_messages_cleanup_cancelled
    ON queue_messages (cancelled_at)
    WHERE cancelled_at IS NOT NULL;
