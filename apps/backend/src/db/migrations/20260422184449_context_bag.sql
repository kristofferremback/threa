-- Context-bag primitive: a typed collection of context references attached to
-- a stream, resolved on every AI turn. Powers "Discuss with Ariadne" (and later
-- summarize-stream, explain-selection, etc.).
--
-- stream_context_attachments: one row per (stream_id, intent) — the bag itself.
-- `refs` is a JSONB array of ContextRef (@threa/types). `last_rendered` is a
-- snapshot from the previous turn — on each new turn the resolver diffs the
-- current ref state against this snapshot to narrate edits/deletes/appends in
-- the volatile delta region while the stable prompt prefix stays byte-identical.
--
-- context_summaries: shared, access-gated summary cache. Keyed by
-- (workspace_id, ref_kind, ref_key, fingerprint). The fingerprint hashes the
-- explicit `inputs` manifest (which messageIds + contentFingerprints + edit
-- timestamps went into the summary), so any drift in any input produces a cache
-- miss and a fresh summary — no silent-drift failure mode. Cache hits are only
-- returned after the resolver re-verifies the caller can access the underlying
-- ref; a hit without access behaves as a miss.
--
-- Per INV-1 no foreign keys. Per INV-3 intent/ref_kind are TEXT validated in
-- application code, not enums. Per INV-2 ids are prefixed ULIDs (sca_, cs_).
-- Per INV-8 both tables are workspace-scoped. Per INV-17 this file is
-- append-only; future changes go in new migration files. Per INV-57 this is
-- workflow/tracking state and lives in its own table rather than on `streams`.

CREATE TABLE IF NOT EXISTS stream_context_attachments (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  stream_id     TEXT NOT NULL,
  intent        TEXT NOT NULL,
  refs          JSONB NOT NULL,
  last_rendered JSONB,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sca_stream ON stream_context_attachments (stream_id);
CREATE INDEX IF NOT EXISTS idx_sca_workspace ON stream_context_attachments (workspace_id);

CREATE TABLE IF NOT EXISTS context_summaries (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  ref_kind     TEXT NOT NULL,
  ref_key      TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  inputs       JSONB NOT NULL,
  summary_text TEXT NOT NULL,
  model        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cs_lookup
  ON context_summaries (workspace_id, ref_kind, ref_key, fingerprint);
