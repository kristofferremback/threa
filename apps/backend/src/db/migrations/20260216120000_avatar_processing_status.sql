-- Avatar upload tracking table (INV-57: processing state separate from domain entity)
CREATE TABLE avatar_uploads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  raw_s3_key TEXT NOT NULL,
  replaces_avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_avatar_uploads_member ON avatar_uploads (member_id, created_at DESC);
