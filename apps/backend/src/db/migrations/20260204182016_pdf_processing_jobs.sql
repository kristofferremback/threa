-- Create pdf_processing_jobs table for fan-out/fan-in coordination
-- Tracks overall PDF processing state and page completion counts

CREATE TABLE pdf_processing_jobs (
    id TEXT PRIMARY KEY,                          -- pdfjob_<ulid>
    attachment_id TEXT NOT NULL UNIQUE,           -- One job per attachment
    workspace_id TEXT NOT NULL,

    -- Page tracking for fan-in coordination
    total_pages INTEGER NOT NULL,
    pages_completed INTEGER NOT NULL DEFAULT 0,
    pages_failed INTEGER NOT NULL DEFAULT 0,

    -- Overall job status
    status TEXT NOT NULL DEFAULT 'preparing',     -- preparing | processing_pages | assembling | completed | failed
    error_message TEXT,

    -- Timing
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for looking up job by attachment
CREATE INDEX idx_pdf_processing_jobs_attachment ON pdf_processing_jobs (attachment_id);

-- Index for finding active jobs (for monitoring/cleanup)
CREATE INDEX idx_pdf_processing_jobs_active
    ON pdf_processing_jobs (status, started_at)
    WHERE status NOT IN ('completed', 'failed');
