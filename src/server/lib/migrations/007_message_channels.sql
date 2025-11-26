-- Message Channels junction table for cross-posting messages to multiple channels
-- A message has a primary channel_id, but can also appear in additional channels via this table

CREATE TABLE IF NOT EXISTS message_channels (
    message_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_message_channels_message ON message_channels(message_id);
CREATE INDEX IF NOT EXISTS idx_message_channels_channel ON message_channels(channel_id);

COMMENT ON TABLE message_channels IS 'Links messages to channels for cross-posting. Primary channel is in messages.channel_id, additional channels here.';

