-- =============================================================================
-- Memos: GAM (General Agentic Memory) knowledge extraction from conversations
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Memos: Semantic pointers to valuable knowledge in conversations
-- Following GAM paper: lightweight abstracts that guide retrieval at runtime
-- -----------------------------------------------------------------------------
CREATE TABLE memos (
    id TEXT PRIMARY KEY,                          -- memo_<ulid>
    workspace_id TEXT NOT NULL,

    -- Type and source
    memo_type TEXT NOT NULL,                      -- 'message' | 'conversation'
    source_message_id TEXT,                       -- For message memos (single source)
    source_conversation_id TEXT,                  -- For conversation memos

    -- Content (following GAM reference: lightweight abstracts)
    title TEXT NOT NULL,
    abstract TEXT NOT NULL,                       -- 1 paragraph summary
    key_points TEXT[] NOT NULL DEFAULT '{}',      -- Additional structure for Threa

    -- Source references (semantic pointers)
    source_message_ids TEXT[] NOT NULL,           -- All messages that informed this memo
    participant_ids TEXT[] NOT NULL,

    -- Classification
    knowledge_type TEXT NOT NULL,                 -- decision|learning|procedure|context|reference
    tags TEXT[] NOT NULL DEFAULT '{}',
    embedding vector(1536),

    -- Memo relationships
    parent_memo_id TEXT,                          -- Message memo rolled into conversation memo

    -- Lifecycle & revision
    status TEXT NOT NULL DEFAULT 'active',        -- draft|active|archived|superseded
    version INTEGER NOT NULL DEFAULT 1,
    revision_reason TEXT,                         -- Why this version was created

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT memo_type_source CHECK (
        (memo_type = 'message' AND source_message_id IS NOT NULL) OR
        (memo_type = 'conversation' AND source_conversation_id IS NOT NULL)
    )
);

-- Indexes
CREATE INDEX idx_memos_workspace ON memos (workspace_id);
CREATE INDEX idx_memos_type ON memos (workspace_id, memo_type);
CREATE INDEX idx_memos_source_message ON memos (source_message_id) WHERE source_message_id IS NOT NULL;
CREATE INDEX idx_memos_source_conversation ON memos (source_conversation_id) WHERE source_conversation_id IS NOT NULL;
CREATE INDEX idx_memos_status ON memos (workspace_id, status) WHERE status = 'active';
CREATE INDEX idx_memos_tags ON memos USING GIN (tags);
CREATE INDEX idx_memos_embedding ON memos USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_memos_parent ON memos (parent_memo_id) WHERE parent_memo_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Pending Items Queue: Accumulates items for batch processing
-- Per-stream debouncing for faster results (not per-workspace)
-- -----------------------------------------------------------------------------
CREATE TABLE memo_pending_items (
    id TEXT PRIMARY KEY,                          -- pending_<ulid>
    workspace_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,                      -- Top-level stream (for debounce grouping)
    item_type TEXT NOT NULL,                      -- 'message' | 'conversation'
    item_id TEXT NOT NULL,                        -- messageId or conversationId
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,

    UNIQUE (workspace_id, item_type, item_id)     -- Dedupe
);

CREATE INDEX idx_pending_unprocessed ON memo_pending_items (workspace_id, stream_id, queued_at)
    WHERE processed_at IS NULL;

-- -----------------------------------------------------------------------------
-- Stream State: Tracks last processing time per stream for debounce logic
-- Cap: process at most every 5 minutes per stream
-- Quick: process after 30s quiet per stream
-- -----------------------------------------------------------------------------
CREATE TABLE memo_stream_state (
    workspace_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    last_processed_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, stream_id)
);
