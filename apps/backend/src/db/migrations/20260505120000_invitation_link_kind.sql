-- Link-based invitations
-- Adds a `kind` discriminator + token_hash for link invites + admin-only note.
-- Email becomes nullable: link invites have no email at creation, only after the
-- recipient claims the link. The atomic single-use claim is enforced via the
-- existing status lifecycle (`UPDATE … WHERE status='pending' AND email IS NULL`).

ALTER TABLE workspace_invitations ADD COLUMN kind TEXT NOT NULL DEFAULT 'email';
ALTER TABLE workspace_invitations ADD COLUMN token_hash TEXT;
ALTER TABLE workspace_invitations ADD COLUMN note TEXT;

ALTER TABLE workspace_invitations ALTER COLUMN email DROP NOT NULL;

CREATE UNIQUE INDEX idx_workspace_invitations_token_hash
  ON workspace_invitations (token_hash) WHERE token_hash IS NOT NULL;

CREATE INDEX idx_workspace_invitations_workspace_kind
  ON workspace_invitations (workspace_id, kind, status);
