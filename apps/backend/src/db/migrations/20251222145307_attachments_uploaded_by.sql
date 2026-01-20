-- Track who uploaded each attachment for ownership-based deletion
-- Nullable for backwards compatibility with existing attachments
ALTER TABLE attachments ADD COLUMN uploaded_by TEXT;

-- Backfill existing attached files: set uploaded_by to message author
UPDATE attachments a
SET uploaded_by = m.author_id
FROM messages m
WHERE a.message_id = m.id AND a.uploaded_by IS NULL;

-- Index for querying user's uploads (e.g., for cleanup UI)
CREATE INDEX idx_attachments_uploaded_by ON attachments (uploaded_by)
  WHERE uploaded_by IS NOT NULL;
