-- =============================================================================
-- Thread Unique Constraint: Ensures only one thread per parent message
-- =============================================================================
-- This enables idempotent thread creation - multiple users clicking "reply"
-- on the same message will get the same thread (find-or-create semantics).

CREATE UNIQUE INDEX idx_streams_thread_parent
ON streams (parent_stream_id, parent_message_id)
WHERE parent_message_id IS NOT NULL;
