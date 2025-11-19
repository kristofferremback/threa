-- Migration: Threading model and workspace-organization coupling
-- Adds conversations table, updates messages for threading, adds organization_id to workspaces

-- Add workos_organization_id to workspaces for 1-to-1 coupling with WorkOS organizations
ALTER TABLE workspaces
ADD COLUMN IF NOT EXISTS workos_organization_id TEXT UNIQUE;

-- Create index for organization lookup
CREATE INDEX IF NOT EXISTS idx_workspaces_organization ON workspaces(workos_organization_id);

-- Conversations table (can exist in multiple channels)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  root_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Many-to-many: conversations ↔ channels
CREATE TABLE IF NOT EXISTS conversation_channels (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT false, -- Which channel it was posted in
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, channel_id)
);

-- Update messages table to support threading
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS reply_to_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL;

-- Add workspace_id to existing messages (backfill)
-- For existing messages, set workspace_id from channel's workspace
UPDATE messages
SET workspace_id = (
  SELECT workspace_id FROM channels WHERE channels.id = messages.channel_id
)
WHERE workspace_id IS NULL;

-- Make workspace_id NOT NULL after backfill
ALTER TABLE messages
ALTER COLUMN workspace_id SET NOT NULL;

-- Indexes for threading queries
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_workspace ON messages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversation_channels_channel ON conversation_channels(channel_id);
CREATE INDEX IF NOT EXISTS idx_conversation_channels_conv ON conversation_channels(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversations_root_message ON conversations(root_message_id);

