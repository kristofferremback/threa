-- Personal bots: owned by a single user, listable as quick-switcher commands.
-- Adds an explicit `type` discriminator (shared vs personal), an optional
-- owner reference, and a `traits` capability set so callers can filter bots
-- by capability (e.g. interactive bots show up in the scratchpad menu).
--
-- Shape invariant (enforced in application code, not DB — INV-1, INV-3):
--   (type = 'shared'   AND owner_user_id IS NULL) OR
--   (type = 'personal' AND owner_user_id IS NOT NULL)
--
-- Existing rows are admin-created shared bots, so they backfill to:
--   type = 'shared', owner_user_id = NULL, traits = '{}'

ALTER TABLE bots ADD COLUMN type TEXT NOT NULL DEFAULT 'shared';
ALTER TABLE bots ADD COLUMN owner_user_id TEXT;
ALTER TABLE bots ADD COLUMN traits TEXT[] NOT NULL DEFAULT '{}';

-- Lookup index for the per-user personal bot list (`/me/bots`).
CREATE INDEX idx_bots_workspace_owner
  ON bots (workspace_id, owner_user_id)
  WHERE owner_user_id IS NOT NULL;
