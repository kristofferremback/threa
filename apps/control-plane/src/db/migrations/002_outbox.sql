-- Outbox event log — same schema as regional backend.
-- Reuses the shared outbox infrastructure from @threa/backend-common.

CREATE TABLE outbox (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outbox_id ON outbox (id);

-- Cursor-based listener tracking
CREATE TABLE outbox_listeners (
    listener_id TEXT PRIMARY KEY,
    last_processed_id BIGINT NOT NULL DEFAULT 0,
    last_processed_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    retry_after TIMESTAMPTZ,
    last_error TEXT,
    locked_until TIMESTAMPTZ,
    lock_run_id TEXT,
    processed_ids JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outbox_listeners_lock
    ON outbox_listeners (listener_id, locked_until);

-- Dead letters for events that exceed max retries
CREATE TABLE outbox_dead_letters (
    id BIGSERIAL PRIMARY KEY,
    listener_id TEXT NOT NULL,
    outbox_event_id BIGINT NOT NULL,
    error TEXT,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outbox_dead_letters_listener ON outbox_dead_letters (listener_id);
