-- Add mentions column to messages table
-- Stores structured mention data extracted from the message content
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mentions JSONB DEFAULT '[]'::jsonb;

-- Create index for efficient mention queries (e.g., "find all messages that mention user X")
CREATE INDEX IF NOT EXISTS idx_messages_mentions ON messages USING GIN (mentions);

-- Create notifications table for activity feed
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),

  -- Notification type: mention, thread_reply, channel_join, crosspost
  notification_type TEXT NOT NULL,

  -- Source references
  message_id TEXT REFERENCES messages(id),
  channel_id TEXT REFERENCES channels(id),
  conversation_id TEXT REFERENCES conversations(id),

  -- Actor who triggered the notification
  actor_id TEXT REFERENCES users(id),

  -- Preview content (e.g., first 100 chars of message)
  preview TEXT,

  -- Read state
  read_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure we don't create duplicate notifications
  CONSTRAINT unique_notification UNIQUE (workspace_id, user_id, notification_type, message_id, actor_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, read_at)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications (workspace_id, user_id);

-- Comment on the table structure
COMMENT ON TABLE notifications IS 'Activity feed notifications for users';
COMMENT ON COLUMN notifications.notification_type IS 'Types: mention, thread_reply, channel_join, crosspost';
COMMENT ON COLUMN messages.mentions IS 'JSONB array of {type, id, label, slug?} for @user, #channel, #+crosspost mentions';

