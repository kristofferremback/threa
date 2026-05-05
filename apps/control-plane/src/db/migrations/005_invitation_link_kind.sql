-- Link-based invitations (CP shadow side).
-- The shadow mirrors the regional row. Email is null at creation for link invites.
-- The token hash is mirrored so the public /api/invitations/lookup endpoint
-- can resolve workspace metadata without a regional round-trip.

ALTER TABLE invitation_shadows ADD COLUMN kind TEXT NOT NULL DEFAULT 'email';
ALTER TABLE invitation_shadows ADD COLUMN token_hash TEXT;

ALTER TABLE invitation_shadows ALTER COLUMN email DROP NOT NULL;

CREATE UNIQUE INDEX idx_invitation_shadows_token_hash
  ON invitation_shadows (token_hash) WHERE token_hash IS NOT NULL;
