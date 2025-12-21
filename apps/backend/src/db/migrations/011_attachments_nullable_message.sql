-- Make message_id nullable for upload-then-attach flow
-- Files are uploaded first, then attached to messages
ALTER TABLE attachments ALTER COLUMN message_id DROP NOT NULL;

-- Index for finding unattached files (for cleanup jobs)
CREATE INDEX idx_attachments_unattached ON attachments (created_at)
  WHERE message_id IS NULL;
