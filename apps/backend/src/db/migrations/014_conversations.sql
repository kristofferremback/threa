-- =============================================================================
-- Conversations: Extracted conversational boundaries from message streams
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Conversations: A coherent unit of discussion within a stream
-- -----------------------------------------------------------------------------
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,                          -- conv_<ulid>
    stream_id TEXT NOT NULL,                      -- Primary stream where conversation lives
    workspace_id TEXT NOT NULL,                   -- For sharding/access control

    -- Message references (one-way: conversation -> messages, not vice versa)
    -- A message ID can appear in multiple conversations (e.g., thread root)
    message_ids TEXT[] NOT NULL DEFAULT '{}',

    -- Participants in this conversation
    participant_ids TEXT[] NOT NULL DEFAULT '{}',

    -- LLM-generated summary of what this conversation is about
    topic_summary TEXT,

    -- Completeness score (1-7, content-based; temporal staleness computed on read)
    -- 1 = just started, 7 = fully resolved
    completeness_score INTEGER NOT NULL DEFAULT 1 CHECK (completeness_score BETWEEN 1 AND 7),

    -- Conversation status
    status TEXT NOT NULL DEFAULT 'active',        -- 'active' | 'stalled' | 'resolved'

    -- For thread-spawned conversations (links thread conversation to parent)
    parent_conversation_id TEXT,

    -- Timestamps
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for finding conversations by stream
CREATE INDEX idx_conversations_stream ON conversations (stream_id);

-- Index for finding active conversations in a stream (most common query)
CREATE INDEX idx_conversations_stream_active ON conversations (stream_id, status)
    WHERE status = 'active';

-- Index for finding conversations by workspace (for GAM queries)
CREATE INDEX idx_conversations_workspace ON conversations (workspace_id);

-- Index for finding conversations containing a specific message
CREATE INDEX idx_conversations_messages ON conversations USING GIN (message_ids);

-- Index for finding conversations by participant
CREATE INDEX idx_conversations_participants ON conversations USING GIN (participant_ids);

-- Index for parent conversation lookups (thread relationships)
CREATE INDEX idx_conversations_parent ON conversations (parent_conversation_id)
    WHERE parent_conversation_id IS NOT NULL;

-- Index for finding stalled/unresolved conversations (for notifications)
CREATE INDEX idx_conversations_stalled ON conversations (workspace_id, status, last_activity_at)
    WHERE status IN ('active', 'stalled');
