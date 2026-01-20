-- Make stream_id nullable for workspace-scoped uploads.
-- stream_id is set when attachment is linked to a message, not at upload time.
-- This enables uploads in draft mode where no stream exists yet.
ALTER TABLE attachments ALTER COLUMN stream_id DROP NOT NULL;

-- Update unattached index to include workspace_id for cleanup queries
DROP INDEX IF EXISTS idx_attachments_unattached;
CREATE INDEX idx_attachments_unattached ON attachments (workspace_id, created_at)
  WHERE message_id IS NULL;
