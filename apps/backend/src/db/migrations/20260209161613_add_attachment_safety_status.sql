-- Add attachment safety status for malware scanning/quarantine workflow
-- New uploads start in pending_scan and are promoted to clean after scan

ALTER TABLE attachments
ADD COLUMN IF NOT EXISTS safety_status TEXT NOT NULL DEFAULT 'pending_scan';

-- Existing attachments predate malware scanning and are treated as clean.
UPDATE attachments
SET safety_status = 'clean'
WHERE safety_status = 'pending_scan';

CREATE INDEX IF NOT EXISTS idx_attachments_workspace_safety
    ON attachments (workspace_id, safety_status);
