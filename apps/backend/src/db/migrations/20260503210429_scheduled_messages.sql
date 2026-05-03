-- Scheduled messages — user-authored messages queued for future delivery.
--
-- The fire pipeline reuses queue_messages + ScheduleManager + the
-- EventService.createMessage code path so a delivered scheduled message
-- enters the system identically to a live send.
--
-- queue_message_id stores the cron queue row's id so the service can cancel
-- it in the same tx as a reschedule/cancel/send-now mutation. The status
-- guard at fire time keeps a stale queue tick that lost the cancel race
-- from double-sending (worker re-checks status under CAS).
--
-- edit_lock_owner_id / edit_lock_expires_at form the mutual-exclusion
-- primitive between the editor and the worker. The worker takes the lock
-- via a single CAS (status='pending' AND lock free OR expired) — never
-- select-then-update (INV-20). The editor takes the lock through the
-- /claim endpoint and heartbeats while the modal/composer is open.
--
-- Per INV-1 we don't declare foreign keys; per INV-3 status is TEXT
-- validated in application code; per INV-8 every read/write filters by
-- workspace_id.

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  parent_message_id TEXT,
  content_json JSONB NOT NULL,
  content_markdown TEXT NOT NULL,
  attachment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_message_id TEXT,
  last_error TEXT,
  queue_message_id TEXT,
  edit_lock_owner_id TEXT,
  edit_lock_expires_at TIMESTAMPTZ,
  client_message_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "To send" tab listing (status = 'pending', ordered by scheduled_for ASC) and
-- worker queries that re-check status under the lock CAS.
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_pending_list
  ON scheduled_messages (workspace_id, user_id, scheduled_for ASC)
  WHERE status = 'pending';

-- "Sent" tab listing (status = 'sent', ordered by status_changed_at DESC).
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_sent_list
  ON scheduled_messages (workspace_id, user_id, status_changed_at DESC)
  WHERE status = 'sent';

-- Failed rows for the inline-failure surface in the To send tab.
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_failed_list
  ON scheduled_messages (workspace_id, user_id, status_changed_at DESC)
  WHERE status = 'failed';

-- Composer popover filter ("upcoming sends in this stream").
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_stream_pending
  ON scheduled_messages (workspace_id, stream_id, user_id, scheduled_for ASC)
  WHERE status = 'pending';

-- Idempotency on optimistic create retries — same shape as messages.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_messages_client_id
  ON scheduled_messages (workspace_id, user_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

-- Queue-row pointer lookup for cancel / reschedule paths (workspace-scoped
-- per INV-8 even when the queue id is unique on its own).
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_queue_ref
  ON scheduled_messages (workspace_id, queue_message_id)
  WHERE queue_message_id IS NOT NULL;
