-- Add columns for API-created messages (bot author identity and ownership tracking)
ALTER TABLE messages ADD COLUMN author_display_name TEXT;
ALTER TABLE messages ADD COLUMN api_key_id TEXT;

-- Partial index for ownership checks on API-created messages
CREATE INDEX idx_messages_api_key_id ON messages (api_key_id) WHERE api_key_id IS NOT NULL;
