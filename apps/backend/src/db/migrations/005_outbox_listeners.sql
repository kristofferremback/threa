-- =============================================================================
-- Multi-Listener Outbox: Per-listener cursor tracking and retry state
-- =============================================================================

-- Tracks each listener's progress through the outbox
CREATE TABLE outbox_listeners (
    listener_id TEXT PRIMARY KEY,
    last_processed_id BIGINT NOT NULL DEFAULT 0,
    last_processed_at TIMESTAMPTZ,

    -- Retry state for current batch
    retry_count INTEGER NOT NULL DEFAULT 0,
    retry_after TIMESTAMPTZ,
    last_error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dead letters for events that exceed max retries
CREATE TABLE outbox_dead_letters (
    id BIGSERIAL PRIMARY KEY,
    listener_id TEXT NOT NULL,
    outbox_event_id BIGINT NOT NULL,
    error TEXT,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outbox_dead_letters_listener ON outbox_dead_letters (listener_id);

-- Index for finding events after a cursor (already have idx_outbox_unprocessed on id)
-- The existing idx_outbox_unprocessed WHERE processed_at IS NULL will be dropped
-- after we fully migrate, but for now we add the unconditional index
CREATE INDEX idx_outbox_id ON outbox (id);

-- Seed with broadcast listener, cursor at current max outbox ID
-- This ensures we don't reprocess old events
INSERT INTO outbox_listeners (listener_id, last_processed_id, last_processed_at)
SELECT 'broadcast', COALESCE(MAX(id), 0), NOW()
FROM outbox;
