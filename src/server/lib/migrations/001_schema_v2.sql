-- Consolidated Schema V2
-- Supports: Graph Model, Monetization, Hybrid Messaging, Transactional Outbox
-- Removed FK constraints as requested, relying on application logic

-- 1. Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,

    -- Monetization
    stripe_customer_id TEXT,
    plan_tier TEXT NOT NULL DEFAULT 'free', -- 'free', 'pro', 'enterprise'
    billing_status TEXT NOT NULL DEFAULT 'active',
    seat_limit INTEGER, -- NULL = unlimited
    ai_budget_limit DECIMAL(10, 2),

    -- WorkOS integration
    workos_organization_id TEXT UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug);
CREATE INDEX IF NOT EXISTS idx_workspaces_workos_org ON workspaces(workos_organization_id);

-- 2. Users (synced from WorkOS)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    workos_user_id TEXT UNIQUE,
    timezone TEXT,
    locale TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ
);

-- 3. Workspace Members
CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member', -- 'admin', 'member', 'guest'
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'invited', 'suspended'
    invited_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ,
    removed_at TIMESTAMPTZ,
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);

-- 4. User Workspace Settings (JSONB)
CREATE TABLE IF NOT EXISTS user_workspace_settings (
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, workspace_id)
);

-- 5. Channels
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL, -- Unique per workspace
    description TEXT,
    topic TEXT,
    visibility TEXT NOT NULL DEFAULT 'public', -- 'public', 'private', 'direct'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    UNIQUE (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_channels_workspace ON channels(workspace_id);

-- 6. Channel Members
CREATE TABLE IF NOT EXISTS channel_members (
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    added_by_user_id TEXT,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Notification & Read State
    notify_level TEXT NOT NULL DEFAULT 'default', -- 'default', 'all', 'mentions', 'muted'
    last_read_message_id TEXT,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id);

-- 7. Conversations (Threads)
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    root_message_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversations_root_message ON conversations(root_message_id);

-- 8. Conversation Channels (Graph Edges)
CREATE TABLE IF NOT EXISTS conversation_channels (
    conversation_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conversation_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_channels_conv ON conversation_channels(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_channels_channel ON conversation_channels(channel_id);

-- 9. Conversation Members (Followers)
CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    added_by_user_id TEXT,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Notification & Read State
    notify_level TEXT NOT NULL DEFAULT 'default', -- 'default', 'all', 'mentions', 'muted'
    last_read_message_id TEXT,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON conversation_members(user_id);

-- 10. Messages
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    channel_id TEXT NOT NULL, -- Context (Primary channel)
    author_id TEXT NOT NULL,
    content TEXT NOT NULL,

    -- Threading
    conversation_id TEXT,
    reply_to_message_id TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_workspace ON messages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_id);

-- 11. Message Revisions
CREATE TABLE IF NOT EXISTS message_revisions (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_message_revisions_message ON message_revisions(message_id);

-- 12. Message Reactions
CREATE TABLE IF NOT EXISTS message_reactions (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reaction TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (message_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);

-- 13. Transactional Outbox
CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed ON outbox(created_at) WHERE processed_at IS NULL;
