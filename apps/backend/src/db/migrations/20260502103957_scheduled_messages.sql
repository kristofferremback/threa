-- Scheduled messages.
--
-- Rows are workspace/user scoped and move through TEXT statuses validated by
-- application code. Queue pointers mirror saved-message reminders: replacing a
-- scheduled time tombstones the old queue row and stores the new row id.
--
-- `version` is the optimistic concurrency token used by editor/save/delete
-- flows so stale clients cannot overwrite a row the scheduler has already sent.

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_at TIMESTAMPTZ NOT NULL,
  content_json JSONB NOT NULL,
  content_markdown TEXT NOT NULL,
  attachment_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  client_message_id TEXT NOT NULL,
  queue_message_id TEXT,
  sent_message_id TEXT,
  edit_previous_status TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  sent_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_messages_client_message
  ON scheduled_messages (workspace_id, stream_id, client_message_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_user_list
  ON scheduled_messages (workspace_id, user_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_pending
  ON scheduled_messages (workspace_id, scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_queue_ref
  ON scheduled_messages (queue_message_id)
  WHERE queue_message_id IS NOT NULL;
