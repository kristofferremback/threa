-- ============================================================================
-- Add client_message_id to stream_events for idempotent message creation
-- ============================================================================
-- Prevents duplicate messages when clients retry failed sends.
-- The client generates a unique ID before sending and passes it with each
-- attempt. If the server already has an event with that client_message_id
-- for the stream, it returns the existing event instead of creating a duplicate.

ALTER TABLE stream_events
ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(255);

COMMENT ON COLUMN stream_events.client_message_id IS 'Client-generated ID for idempotent message creation';

-- Unique partial index ensures no duplicate client_message_id per stream
-- Partial index (WHERE NOT NULL) allows multiple NULL values
CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_events_client_message_id
    ON stream_events(stream_id, client_message_id)
    WHERE client_message_id IS NOT NULL;
