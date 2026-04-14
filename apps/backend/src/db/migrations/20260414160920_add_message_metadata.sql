-- Add opt-in `metadata` map (string -> string) on messages so external callers can
-- attach references (e.g. GitHub PR id, event type) and later dedupe/query by them
-- using AND-containment semantics.
--
-- Shape and limits are enforced in application code (INV-3). Reserved key prefix
-- `threa.*` is held for system-generated metadata.

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- jsonb_path_ops is the right opclass for `@>` containment lookups; smaller and
-- faster than the default jsonb_ops when we only ever use containment.
CREATE INDEX IF NOT EXISTS idx_messages_metadata_gin
    ON messages USING GIN (metadata jsonb_path_ops)
    WHERE deleted_at IS NULL;
