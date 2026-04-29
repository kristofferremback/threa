-- attachment_references: tracks inline references of attachments from messages
-- other than the originally-attached one. Lets a user copy a message that
-- contains attachments and resend it (or any future Ariadne flow that
-- re-surfaces attachments) without overwriting the original
-- `attachments.message_id`/`stream_id` ownership, while still letting
-- recipients of the new message resolve download access.
--
-- One row per (attachment, referencing message) pair. The author's own
-- newly-uploaded attachment also gets a row at create-time so download
-- access lookups can consult a single index regardless of whether the
-- attachment was originally uploaded into this message or referenced from
-- a different one.
--
-- INV-1 (no FKs), INV-2 (prefixed ULID), INV-8 (workspace-scoped), INV-17
-- (append-only).

CREATE TABLE attachment_references (
    id TEXT PRIMARY KEY,                        -- aref_xxx ULID
    workspace_id TEXT NOT NULL,
    attachment_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Compound unique index serves both the INSERT ... ON CONFLICT idempotency
-- and `WHERE attachment_id = X` lookups (Postgres uses the leftmost prefix).
-- The `findByAttachmentId` repo path also filters on `workspace_id`; since
-- `attachment_id` is a workspace-unique ULID, per-attachment row count is
-- small (≈ message-fanout for that attachment), so the heap-side workspace
-- check stays trivially cheap. Adding workspace_id to the index isn't worth
-- the extra write/space cost.
CREATE UNIQUE INDEX attachment_references_pair_idx
    ON attachment_references (attachment_id, message_id);

-- Backfill: every existing attachment whose message_id is set already counts
-- as a reference from that message. New rows get inserted at message-create
-- time so this backfill is one-time only. ID shape matches the established
-- migration-backfill convention (`<prefix>_<uuid_hex>` — see `member_*` in
-- 20260207120000_member_identity.sql and `stream_*` in
-- 20260210140000_backfill_system_streams.sql); these one-time rows trade
-- INV-2 time-sortability for not pulling a Postgres ULID extension into
-- migrations. Application-side inserts use `generateId("aref")` which is
-- a real ULID.
INSERT INTO attachment_references (id, workspace_id, attachment_id, message_id, stream_id, created_at)
SELECT
    'aref_' || replace(gen_random_uuid()::text, '-', ''),
    workspace_id,
    id,
    message_id,
    stream_id,
    created_at
FROM attachments
WHERE message_id IS NOT NULL AND stream_id IS NOT NULL
ON CONFLICT (attachment_id, message_id) DO NOTHING;
