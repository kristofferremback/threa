-- Shared messages tracking table (INV-57).
-- Records cross-stream message shares — each row is a durable grant from a
-- source message into a target stream. Enables pointer hydration, per-viewer
-- access checks, and invalidation on source edits.
--
-- See docs/plans/message-sharing-streams.md (D6, D8) for the design.
-- flavor is TEXT validated in code (INV-3). No foreign keys (INV-1).

CREATE TABLE shared_messages (
    id TEXT PRIMARY KEY,                       -- share_xxx ULID (INV-2)
    workspace_id TEXT NOT NULL,                -- INV-8
    share_message_id TEXT NOT NULL,            -- the message in the target stream
    source_message_id TEXT NOT NULL,
    source_stream_id TEXT NOT NULL,
    target_stream_id TEXT NOT NULL,
    flavor TEXT NOT NULL,                      -- 'pointer' | 'quote' (INV-3)
    created_by TEXT NOT NULL,                  -- UserId / actor id
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX shared_messages_target_idx ON shared_messages (target_stream_id, share_message_id);
CREATE INDEX shared_messages_source_idx ON shared_messages (source_message_id);
CREATE INDEX shared_messages_workspace_idx ON shared_messages (workspace_id, created_at DESC);
