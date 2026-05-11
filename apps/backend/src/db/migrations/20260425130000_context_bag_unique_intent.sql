-- 20260425130000_context_bag_unique_intent.sql
--
-- Enforces the documented "one row per (stream_id, intent)" invariant on
-- `stream_context_attachments`. Without this constraint, concurrent inserts
-- from the `stream:created` outbox handler and the standalone
-- `POST /context-bag/precompute` endpoint can race and produce duplicate
-- rows, after which `ContextBagRepository.findByStream` returns whichever
-- Postgres orders first and the snapshot stream silently splits.
--
-- The unique index also unblocks idempotent `INSERT … ON CONFLICT
-- (stream_id, intent) DO UPDATE` writes at the repository layer, replacing
-- today's race-prone select-then-insert pattern (INV-20).
--
-- Append-only per INV-17. This migration was raised in PR #411 review.

CREATE UNIQUE INDEX IF NOT EXISTS idx_sca_stream_intent_unique
  ON stream_context_attachments (stream_id, intent);
