CREATE TABLE scheduled_messages (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL,
  author_id          TEXT NOT NULL,
  stream_id          TEXT,
  parent_message_id  TEXT,
  parent_stream_id   TEXT,
  content_json       JSONB NOT NULL,
  content_markdown   TEXT NOT NULL,
  attachment_ids     TEXT[] NOT NULL DEFAULT '{}',
  scheduled_at       TIMESTAMPTZ NOT NULL,
  sent_at            TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  paused_at          TIMESTAMPTZ,
  message_id         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sm_workspace ON scheduled_messages (workspace_id);
CREATE INDEX idx_sm_workspace_scheduled ON scheduled_messages (workspace_id, scheduled_at);
CREATE INDEX idx_sm_workspace_stream ON scheduled_messages (workspace_id, stream_id);
CREATE INDEX idx_sm_workspace_author_pending_scheduled
  ON scheduled_messages (workspace_id, author_id, scheduled_at)
  WHERE sent_at IS NULL AND cancelled_at IS NULL AND paused_at IS NULL;
CREATE INDEX idx_sm_workspace_author_stream_pending_scheduled
  ON scheduled_messages (workspace_id, author_id, stream_id, scheduled_at)
  WHERE sent_at IS NULL AND cancelled_at IS NULL AND paused_at IS NULL;
