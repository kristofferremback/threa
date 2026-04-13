-- Video transcode jobs tracking table (INV-57).
-- Stores transient workflow state for AWS MediaConvert video transcoding.
-- Processed video and thumbnail S3 paths are stored here, not on the core attachments table.

CREATE TABLE video_transcode_jobs (
    id TEXT PRIMARY KEY,
    attachment_id TEXT NOT NULL UNIQUE,
    workspace_id TEXT NOT NULL,
    mediaconvert_job_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    processed_storage_path TEXT,
    thumbnail_storage_path TEXT,
    error_message TEXT,
    submitted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_video_transcode_jobs_attachment ON video_transcode_jobs (attachment_id);
CREATE INDEX idx_video_transcode_jobs_active
    ON video_transcode_jobs (status, created_at)
    WHERE status NOT IN ('completed', 'failed');
