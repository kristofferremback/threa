-- Sliding window cursor for outbox listeners.
-- Tracks recently processed event IDs to handle BIGSERIAL gaps
-- from concurrent transaction commits.

ALTER TABLE outbox_listeners
  ADD COLUMN IF NOT EXISTS processed_ids JSONB NOT NULL DEFAULT '{}';
