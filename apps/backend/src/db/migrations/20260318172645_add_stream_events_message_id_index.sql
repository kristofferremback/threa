-- Expression index for findByMessageId (jump-to-message from search).
-- Without this, the JSONB expression payload->>'messageId' requires a
-- linear scan of all message_created events in a stream.
-- The partial index + stream_id composite makes the lookup O(log n).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stream_events_message_id
  ON stream_events (stream_id, (payload->>'messageId'))
  WHERE event_type = 'message_created';
