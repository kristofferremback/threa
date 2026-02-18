CREATE TABLE message_versions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  content_json JSONB NOT NULL,
  content_markdown TEXT NOT NULL,
  edited_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_message_versions_message_seq ON message_versions (message_id, version_number);
CREATE INDEX idx_message_versions_message_id ON message_versions (message_id, created_at DESC);
