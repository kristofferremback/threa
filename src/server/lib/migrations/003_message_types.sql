-- Add message_type column to messages table
-- Types: 'message' (default), 'system' (for events like member joined/added)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'message';

-- Add metadata column for system messages (JSON for storing event details)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);

-- Add role column to channel_members table
ALTER TABLE channel_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';

