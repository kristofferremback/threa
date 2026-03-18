-- Add client_id column to messages for idempotent message creation.
-- When the frontend queues a message via IndexedDB, it generates a client-side
-- ID (clientId). If the send succeeds but the local cleanup is interrupted
-- (e.g. tab suspension, device sleep), the queue will re-send the same message
-- on reconnect. This column + unique index lets the server deduplicate.

ALTER TABLE messages ADD COLUMN client_id TEXT;

-- Partial unique index: only enforce uniqueness when client_id is provided.
-- AI/external senders that omit client_id are unaffected.
CREATE UNIQUE INDEX messages_stream_id_client_id_unique
  ON messages (stream_id, client_id)
  WHERE client_id IS NOT NULL;
