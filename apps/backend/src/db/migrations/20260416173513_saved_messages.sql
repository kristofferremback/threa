-- Saved messages (a.k.a. todos with optional reminders).
--
-- One row per (workspace_id, user_id, message_id) — each user maintains their
-- own save state for a given message. Status is saved | done | archived.
--
-- Done and archived behave identically for reminder cancellation but have
-- distinct UI intent: done = "I completed this", archived = "I won't do this".
--
-- Reminders are delivered via the existing queue_messages pipeline. The
-- reminder_queue_message_id pointer lets us tombstone a pending reminder when
-- the user clears remind_at, marks done/archived, or changes remind_at.
--
-- reminder_sent_at is the idempotency flag for the delivery worker: the UPDATE
-- in the worker is guarded by `reminder_sent_at IS NULL` to prevent double-fire
-- even if the queue re-delivers a claimed message.
--
-- Per INV-1 we don't declare foreign keys; per INV-3 status is TEXT validated
-- in application code. The (workspace_id, user_id, message_id) unique index is
-- the INV-20 race-safe upsert conflict target.

CREATE TABLE IF NOT EXISTS saved_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'saved',
  remind_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  reminder_queue_message_id TEXT,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upsert conflict target
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_messages_unique
  ON saved_messages (workspace_id, user_id, message_id);

-- Saved tab listing (status = 'saved', ordered by saved_at DESC)
CREATE INDEX IF NOT EXISTS idx_saved_messages_saved_list
  ON saved_messages (workspace_id, user_id, saved_at DESC)
  WHERE status = 'saved';

-- Done/Archived tab listings — separate partial indexes because Done and
-- Archived are different tabs with their own ordering by status_changed_at.
CREATE INDEX IF NOT EXISTS idx_saved_messages_done_list
  ON saved_messages (workspace_id, user_id, status_changed_at DESC)
  WHERE status = 'done';

CREATE INDEX IF NOT EXISTS idx_saved_messages_archived_list
  ON saved_messages (workspace_id, user_id, status_changed_at DESC)
  WHERE status = 'archived';

-- Queue-row lookup (for tombstoning when status changes or reminder is cleared)
CREATE INDEX IF NOT EXISTS idx_saved_messages_queue_ref
  ON saved_messages (reminder_queue_message_id)
  WHERE reminder_queue_message_id IS NOT NULL;
