CREATE TABLE pending_tasks (
    id TEXT PRIMARY KEY,
    task_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 10,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    last_error TEXT
);

-- Worker polls for tasks ready to process
CREATE INDEX idx_pending_tasks_ready
    ON pending_tasks (next_attempt_at)
    WHERE status = 'pending';
