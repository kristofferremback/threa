-- Consolidated Schema V2
-- Supports: Graph Model, Monetization, Hybrid Messaging, Transactional Outbox

-- 1. Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE, -- Added for URL friendliness
    
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Workspace Members
CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member', -- 'admin', 'member', 'guest'
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'invited', 'suspended'
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);

-- 4. Channels
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL, -- Unique per workspace
    description TEXT,
    topic TEXT,
    visibility TEXT NOT NULL DEFAULT 'public', -- 'public', 'private'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_channels_workspace ON channels(workspace_id);

-- 5. Channel Members (for private channels & presence)
CREATE TABLE IF NOT EXISTS channel_members (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, user_id)
);

-- 6. Conversations (The Thread Entity)
-- Note: root_message_id FK constraint added after messages table is created
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  root_message_id TEXT NOT NULL, -- FK constraint added later
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversations_root_message ON conversations(root_message_id);

-- 7. Conversation Channels (Graph Edges)
CREATE TABLE IF NOT EXISTS conversation_channels (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT false, -- Where it was originally posted
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_channels_conv ON conversation_channels(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_channels_channel ON conversation_channels(channel_id);

-- 8. Messages (Hybrid: Flat vs Threaded)
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, -- Context
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    
    -- Threading
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    reply_to_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

-- Add FK constraint for conversation root_message_id now that messages table exists
ALTER TABLE conversations 
ADD CONSTRAINT fk_conversations_root_message 
FOREIGN KEY (root_message_id) REFERENCES messages(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_workspace ON messages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_id);

-- 9. Transactional Outbox
CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL, -- 'message.created', 'conversation.created', etc.
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed ON outbox(created_at) WHERE processed_at IS NULL;

