-- Outbox retention support indexes
-- Enables efficient watermark + retention window cleanup scans

CREATE INDEX IF NOT EXISTS idx_outbox_retention_cutoff
    ON outbox (created_at, id);
