-- =============================================================================
-- Core Schema: Workspaces, Streams, Events, Messages, Attachments, Personas
-- =============================================================================

-- Enable pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- Workspaces: Multi-tenant organization containers
-- -----------------------------------------------------------------------------
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,                          -- ws_<ulid>
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,                    -- URL-friendly identifier
    created_by TEXT NOT NULL,                     -- user id who created it
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workspaces_slug ON workspaces (slug);

-- -----------------------------------------------------------------------------
-- Workspace Members: User membership in workspaces
-- -----------------------------------------------------------------------------
CREATE TABLE workspace_members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',          -- 'owner' | 'admin' | 'member'
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_user ON workspace_members (user_id);

-- -----------------------------------------------------------------------------
-- Streams: The core abstraction (scratchpads, channels, DMs, threads)
-- -----------------------------------------------------------------------------
CREATE TABLE streams (
    id TEXT PRIMARY KEY,                          -- stream_<ulid>
    workspace_id TEXT NOT NULL,
    type TEXT NOT NULL,                           -- 'scratchpad' | 'channel' | 'dm' | 'thread'
    name TEXT,                                    -- Display name (nullable for DMs)
    slug TEXT,                                    -- URL-friendly (for channels)
    description TEXT,
    visibility TEXT NOT NULL DEFAULT 'private',   -- 'public' | 'private'

    -- For threads: graph relationships
    parent_stream_id TEXT,              -- Immediate parent (channel, scratchpad, or another thread)
    parent_message_id TEXT,             -- The message this thread branches from
    root_stream_id TEXT,                -- Non-thread ancestor (for visibility inheritance)

    -- AI companion configuration (stream-level, not per-user)
    companion_mode TEXT NOT NULL DEFAULT 'mentions',  -- 'off' | 'mentions' | 'on'
    companion_persona_id TEXT,                   -- Which persona (null = workspace default)

    -- Full-text search (for finding scratchpads/channels by name)
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', COALESCE(name, '') || ' ' || COALESCE(description, ''))
    ) STORED,

    -- Metadata
    created_by TEXT NOT NULL,                     -- user id who created it
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,

    UNIQUE (workspace_id, slug)                   -- Slugs unique within workspace
);

CREATE INDEX idx_streams_workspace ON streams (workspace_id);
CREATE INDEX idx_streams_type ON streams (workspace_id, type);
CREATE INDEX idx_streams_parent ON streams (parent_stream_id) WHERE parent_stream_id IS NOT NULL;
CREATE INDEX idx_streams_root ON streams (root_stream_id) WHERE root_stream_id IS NOT NULL;
CREATE INDEX idx_streams_search ON streams USING GIN (search_vector)
    WHERE archived_at IS NULL;

-- -----------------------------------------------------------------------------
-- Stream Members: User membership in streams + preferences
-- -----------------------------------------------------------------------------
CREATE TABLE stream_members (
    stream_id TEXT NOT NULL,
    user_id TEXT NOT NULL,

    -- User preferences for this stream
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    pinned_at TIMESTAMPTZ,                        -- For sorting pinned items
    muted BOOLEAN NOT NULL DEFAULT FALSE,

    -- Read state
    last_read_event_id TEXT,
    last_read_at TIMESTAMPTZ,

    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (stream_id, user_id)
);

CREATE INDEX idx_stream_members_user ON stream_members (user_id);
CREATE INDEX idx_stream_members_pinned ON stream_members (user_id, pinned) WHERE pinned = TRUE;

-- -----------------------------------------------------------------------------
-- Stream Events: Source of truth (event sourcing)
-- -----------------------------------------------------------------------------
CREATE TABLE stream_events (
    id TEXT PRIMARY KEY,                          -- event_<ulid>
    stream_id TEXT NOT NULL,
    sequence BIGINT NOT NULL,                     -- Monotonic per stream, for sync
    event_type TEXT NOT NULL,                     -- See event types below
    payload JSONB NOT NULL,
    actor_id TEXT,                                -- User or persona who caused this
    actor_type TEXT,                              -- 'user' | 'persona'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (stream_id, sequence)
);

CREATE INDEX idx_stream_events_stream_seq ON stream_events (stream_id, sequence);

-- Event types:
-- 'message_created'    - { message_id, content, content_format, attachments? }
-- 'message_edited'     - { message_id, content, edited_at }
-- 'message_deleted'    - { message_id, deleted_at }
-- 'reaction_added'     - { message_id, emoji, user_id }
-- 'reaction_removed'   - { message_id, emoji, user_id }
-- 'member_joined'      - { user_id }
-- 'member_left'        - { user_id }
-- 'thread_created'     - { thread_id, parent_message_id }
-- 'companion_response' - { message_id, persona_id, session_id? }

-- -----------------------------------------------------------------------------
-- Messages: Projection for efficient querying
-- -----------------------------------------------------------------------------
CREATE TABLE messages (
    id TEXT PRIMARY KEY,                          -- msg_<ulid>
    stream_id TEXT NOT NULL,
    sequence BIGINT NOT NULL,                     -- Copied from event for efficient ordering

    -- Author (user or persona)
    author_id TEXT NOT NULL,
    author_type TEXT NOT NULL,                    -- 'user' | 'persona'

    -- Content
    content TEXT NOT NULL,
    content_format TEXT NOT NULL DEFAULT 'markdown', -- 'markdown' | 'plaintext'

    -- Denormalized counts
    reply_count INTEGER NOT NULL DEFAULT 0,       -- Number of threads branching from this message

    -- Reactions (denormalized for efficient display)
    reactions JSONB NOT NULL DEFAULT '{}',        -- { "emoji": ["user_id", ...], ... }

    -- Full-text search
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', content)
    ) STORED,

    -- State
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_stream_seq ON messages (stream_id, sequence DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_messages_author ON messages (author_id, created_at DESC);
CREATE INDEX idx_messages_search ON messages USING GIN (search_vector)
    WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Attachments: Files attached to messages
-- -----------------------------------------------------------------------------
CREATE TABLE attachments (
    id TEXT PRIMARY KEY,                          -- attach_<ulid>
    workspace_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    message_id TEXT NOT NULL,

    -- File metadata
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,

    -- Storage
    storage_provider TEXT NOT NULL DEFAULT 's3', -- 's3' | 'local'
    storage_path TEXT NOT NULL,                   -- S3 key or local path

    -- For AI processing (Phase 2)
    extracted_text TEXT,
    processing_status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'completed' | 'failed'

    -- Full-text search (filename + extracted text from PDFs/docs)
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', filename || ' ' || COALESCE(extracted_text, ''))
    ) STORED,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attachments_message ON attachments (message_id);
CREATE INDEX idx_attachments_workspace ON attachments (workspace_id);
CREATE INDEX idx_attachments_search ON attachments USING GIN (search_vector);

-- -----------------------------------------------------------------------------
-- Personas: AI agent personalities
-- -----------------------------------------------------------------------------
CREATE TABLE personas (
    id TEXT PRIMARY KEY,                          -- persona_<ulid>
    workspace_id TEXT,                            -- NULL for system personas

    -- Identity
    slug TEXT NOT NULL,                           -- @ariadne, @researcher, etc.
    name TEXT NOT NULL,
    description TEXT,
    avatar_emoji TEXT,                            -- Single emoji for display

    -- AI configuration
    system_prompt TEXT,
    model TEXT NOT NULL DEFAULT 'anthropic:claude-sonnet-4-20250514', -- provider:model
    temperature NUMERIC DEFAULT 0.7,
    max_tokens INTEGER,
    enabled_tools TEXT[],                         -- Tool names this persona can use

    -- Relevance scoring (for multi-agent response selection)
    expertise_triggers TEXT,                      -- Keywords/phrases for domain matching
    expertise_embedding vector(1536),             -- Pre-computed from expertise_triggers

    -- Management
    managed_by TEXT NOT NULL,                     -- 'system' | 'workspace'
    status TEXT NOT NULL DEFAULT 'active',        -- 'active' | 'disabled' | 'archived'

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- System personas have NULL workspace_id, workspace ones have it set
    -- Slugs unique within scope (system or workspace)
    UNIQUE (workspace_id, slug)
);

CREATE INDEX idx_personas_workspace ON personas (workspace_id) WHERE workspace_id IS NOT NULL;
CREATE INDEX idx_personas_system ON personas (slug) WHERE workspace_id IS NULL;

-- -----------------------------------------------------------------------------
-- Stream Persona Roster: Which personas monitor which streams
-- Controls cost by limiting which agents evaluate messages per stream
-- -----------------------------------------------------------------------------
CREATE TABLE stream_persona_roster (
    stream_id TEXT NOT NULL,
    persona_id TEXT NOT NULL,
    eagerness TEXT NOT NULL DEFAULT 'silent',     -- 'silent' | 'reserved' | 'engaged' | 'eager'
    added_by TEXT NOT NULL,                       -- User who added this persona
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (stream_id, persona_id)
);

CREATE INDEX idx_stream_persona_roster_persona ON stream_persona_roster (persona_id);

-- -----------------------------------------------------------------------------
-- Outbox: For reliable event delivery to real-time subscribers
-- -----------------------------------------------------------------------------
CREATE TABLE outbox (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX idx_outbox_unprocessed ON outbox (id) WHERE processed_at IS NULL;

-- -----------------------------------------------------------------------------
-- Sequences: Track next sequence number per stream
-- -----------------------------------------------------------------------------
CREATE TABLE stream_sequences (
    stream_id TEXT PRIMARY KEY,
    next_sequence BIGINT NOT NULL DEFAULT 1
);

-- -----------------------------------------------------------------------------
-- Seed Data: Default system persona (Ariadne)
-- -----------------------------------------------------------------------------
INSERT INTO personas (id, workspace_id, slug, name, description, avatar_emoji, system_prompt, model, managed_by, status)
VALUES (
    'persona_system_ariadne',
    NULL,
    'ariadne',
    'Ariadne',
    'Your AI thinking companion. Ariadne helps you explore ideas, make decisions, and remember what matters.',
    ':thread:',
    'You are Ariadne, an AI thinking companion in Threa. You help users explore ideas, think through problems, and make decisions. You have access to their previous conversations and knowledge base through the GAM (General Agentic Memory) system.

Be concise but thoughtful. Ask clarifying questions when needed. When referencing previous knowledge, cite your sources.',
    'anthropic/claude-3.5-sonnet',
    'system',
    'active'
);
