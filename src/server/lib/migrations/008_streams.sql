-- ============================================================================
-- Stream Model Migration
-- ============================================================================
-- Replaces: channels, conversations, messages, and related junction tables
-- With: unified streams and stream_events model
-- ============================================================================

-- ============================================================================
-- 1. STREAMS (replaces channels + conversations)
-- ============================================================================

CREATE TABLE IF NOT EXISTS streams (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    
    -- Stream type determines behavior and visibility
    stream_type TEXT NOT NULL,  -- 'channel', 'thread', 'dm', 'incident'
    
    -- Identity (required for channels/incidents, optional for threads)
    name TEXT,
    slug TEXT,  -- Unique per workspace for named streams
    description TEXT,
    topic TEXT,
    
    -- Branching relationship (for threads)
    parent_stream_id TEXT,          -- The stream this branched from
    branched_from_event_id TEXT,    -- The specific event that started this thread
    
    -- Visibility and state
    visibility TEXT NOT NULL DEFAULT 'public',  -- 'public', 'private', 'inherit'
    status TEXT NOT NULL DEFAULT 'active',      -- 'active', 'archived', 'resolved'
    
    -- Promotion tracking (when thread becomes channel/incident)
    promoted_at TIMESTAMPTZ,
    promoted_by TEXT,
    
    -- Flexible metadata (incident severity, DM participant cache, etc.)
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ
);

-- Unique slug per workspace (only for named streams)
CREATE UNIQUE INDEX IF NOT EXISTS idx_streams_workspace_slug 
    ON streams(workspace_id, slug) 
    WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_streams_workspace ON streams(workspace_id);
CREATE INDEX IF NOT EXISTS idx_streams_workspace_type ON streams(workspace_id, stream_type);
CREATE INDEX IF NOT EXISTS idx_streams_parent ON streams(parent_stream_id);
CREATE INDEX IF NOT EXISTS idx_streams_branched_from ON streams(branched_from_event_id);

-- ============================================================================
-- 2. STREAM MEMBERS (replaces channel_members + conversation_members)
-- ============================================================================

CREATE TABLE IF NOT EXISTS stream_members (
    stream_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    
    -- Role within the stream
    role TEXT NOT NULL DEFAULT 'member',  -- 'owner', 'admin', 'member'
    
    -- Notification preferences
    notify_level TEXT NOT NULL DEFAULT 'default',  -- 'all', 'mentions', 'muted', 'default'
    
    -- Read state
    last_read_event_id TEXT,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Membership tracking
    added_by_user_id TEXT,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (stream_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_stream_members_user ON stream_members(user_id);
CREATE INDEX IF NOT EXISTS idx_stream_members_stream ON stream_members(stream_id) WHERE left_at IS NULL;

-- ============================================================================
-- 3. STREAM EVENTS (replaces messages)
-- ============================================================================

CREATE TABLE IF NOT EXISTS stream_events (
    id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL,
    
    -- Event classification
    event_type TEXT NOT NULL,  -- 'message', 'shared', 'member_joined', 'member_left', 'poll', 'file', 'thread_started'
    actor_id TEXT NOT NULL,    -- Who performed this action
    
    -- Polymorphic content reference
    content_type TEXT,   -- 'text_message', 'shared_ref', 'poll', 'file'
    content_id TEXT,     -- FK to the content table
    
    -- Inline payload for simple events (member_joined, thread_started, etc.)
    payload JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stream_events_stream ON stream_events(stream_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_events_stream_active ON stream_events(stream_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_stream_events_actor ON stream_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_stream_events_content ON stream_events(content_type, content_id) WHERE content_id IS NOT NULL;

-- ============================================================================
-- 4. TEXT MESSAGES (content table for message events)
-- ============================================================================

CREATE TABLE IF NOT EXISTS text_messages (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    
    -- Structured mentions
    mentions JSONB DEFAULT '[]',  -- [{type: 'user'|'channel'|'crosspost', id, label, slug}]
    
    -- Future: block-based formatting
    formatting JSONB,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 5. SHARED REFS (content table for shared/cross-posted events)
-- ============================================================================

CREATE TABLE IF NOT EXISTS shared_refs (
    id TEXT PRIMARY KEY,
    original_event_id TEXT NOT NULL,  -- The event being shared
    context TEXT,                      -- Optional commentary from sharer
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shared_refs_original ON shared_refs(original_event_id);

-- ============================================================================
-- 6. MESSAGE REVISIONS (adapted for text_messages)
-- ============================================================================

-- Keep the existing message_revisions table structure but it will now
-- reference text_message IDs instead of message IDs
-- The table already exists, just add an index if needed
CREATE INDEX IF NOT EXISTS idx_message_revisions_message_created 
    ON message_revisions(message_id, created_at DESC);

-- ============================================================================
-- 7. NOTIFICATIONS (update to reference stream_events)
-- ============================================================================

-- The notifications table already exists, we'll update references in code
-- to use stream_id + event_id instead of channel_id + message_id

-- Add new columns if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'stream_id') THEN
        ALTER TABLE notifications ADD COLUMN stream_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'event_id') THEN
        ALTER TABLE notifications ADD COLUMN event_id TEXT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_stream ON notifications(stream_id);

-- ============================================================================
-- 8. DROP OLD TABLES
-- ============================================================================
-- Uncomment these when ready to fully migrate

DROP TABLE IF EXISTS message_channels CASCADE;
DROP TABLE IF EXISTS conversation_channels CASCADE;
DROP TABLE IF EXISTS conversation_members CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS channel_members CASCADE;
DROP TABLE IF EXISTS channels CASCADE;
DROP TABLE IF EXISTS messages CASCADE;

-- ============================================================================
-- 9. COMMENTS
-- ============================================================================

COMMENT ON TABLE streams IS 'Unified container for channels, threads, DMs, and incidents';
COMMENT ON TABLE stream_events IS 'All events in a stream - messages, shares, membership changes, etc.';
COMMENT ON TABLE text_messages IS 'Content for message-type events';
COMMENT ON TABLE shared_refs IS 'Content for shared/cross-posted events with optional context';
COMMENT ON TABLE stream_members IS 'Stream membership, notification prefs, and read state';

COMMENT ON COLUMN streams.stream_type IS 'channel=root channel, thread=branched discussion, dm=direct message, incident=promoted incident';
COMMENT ON COLUMN streams.visibility IS 'public=anyone can see, private=members only, inherit=use parent stream visibility';
COMMENT ON COLUMN streams.branched_from_event_id IS 'For threads: the event this discussion started from';
COMMENT ON COLUMN stream_events.event_type IS 'message=text post, shared=cross-post, member_joined/left=system, poll/file=rich content';
COMMENT ON COLUMN stream_events.content_type IS 'Polymorphic: text_message, shared_ref, poll, file - join with content_id';

