-- Queue system tables
-- Replaces pg-boss with custom PostgreSQL-based queue implementation

-- Queue messages table
-- Stores job messages with time-based locking and workspace sharding
CREATE TABLE queue_messages (
    id TEXT PRIMARY KEY,                      -- queue_<ulid>
    queue_name TEXT NOT NULL,                 -- e.g., 'persona.agent', 'naming.generate'
    workspace_id TEXT NOT NULL,               -- Sharding dimension

    payload JSONB NOT NULL,                   -- Job data

    -- Scheduling
    process_after TIMESTAMPTZ NOT NULL,       -- When message becomes available
    inserted_at TIMESTAMPTZ NOT NULL,         -- When message was enqueued

    -- Time-based locking (proven outbox pattern)
    claimed_at TIMESTAMPTZ,                   -- When message was last claimed
    claimed_by TEXT,                          -- worker_<ulid> identifier
    claimed_until TIMESTAMPTZ,                -- Lock expires after this
    claimed_count INTEGER NOT NULL DEFAULT 0, -- Total claims (including orphaned)

    -- Failure tracking
    failed_count INTEGER NOT NULL DEFAULT 0,  -- Explicit failures only
    last_error TEXT,

    -- DLQ (soft delete)
    dlq_at TIMESTAMPTZ,                      -- NULL = active, non-NULL = DLQ

    -- Completion
    completed_at TIMESTAMPTZ                  -- Set on success
);

-- Hot path: Find next available message for a (queue_name, workspace_id) pair
-- Used by claimNext() with FOR UPDATE SKIP LOCKED
-- Note: Cannot use NOW() in WHERE clause (not IMMUTABLE), so index all unclaimed messages
CREATE INDEX idx_queue_messages_available
    ON queue_messages (queue_name, workspace_id, process_after)
    WHERE dlq_at IS NULL
      AND completed_at IS NULL;

-- DLQ queries
CREATE INDEX idx_queue_messages_dlq
    ON queue_messages (queue_name, workspace_id, dlq_at)
    WHERE dlq_at IS NOT NULL;

-- Cleanup: Find completed messages for retention
CREATE INDEX idx_queue_messages_cleanup_completed
    ON queue_messages (completed_at)
    WHERE completed_at IS NOT NULL;


-- Queue tokens table
-- Token pool for work distribution - tokens represent permission to process a (queue, workspace) pair
CREATE TABLE queue_tokens (
    id TEXT PRIMARY KEY,                      -- token_<ulid>
    queue_name TEXT NOT NULL,
    workspace_id TEXT NOT NULL,

    -- Token lease (NOT claim - different from message claims)
    leased_at TIMESTAMPTZ NOT NULL,
    leased_by TEXT NOT NULL,                  -- ticker_<ulid> identifier
    leased_until TIMESTAMPTZ NOT NULL,

    -- Scheduling context
    next_process_after TIMESTAMPTZ NOT NULL,  -- Earliest process_after in this group

    created_at TIMESTAMPTZ NOT NULL
);

-- Check for active tokens for a (queue, workspace) pair
-- Note: Cannot use NOW() in WHERE clause (not IMMUTABLE), so index all tokens
CREATE INDEX idx_queue_tokens_active
    ON queue_tokens (queue_name, workspace_id, leased_until);

-- Cleanup expired tokens
-- Note: Cannot use NOW() in WHERE clause (not IMMUTABLE), so index all tokens by leased_until
CREATE INDEX idx_queue_tokens_cleanup
    ON queue_tokens (leased_until);
