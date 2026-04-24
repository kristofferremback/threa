-- Correct role_slug values for existing workspace invitations.
-- The initial role_slug migration added the column with NOT NULL DEFAULT 'member',
-- so existing rows were populated before the backfill UPDATE ran.

UPDATE workspace_invitations
SET role_slug = CASE
  WHEN role = 'admin' THEN 'admin'
  ELSE 'member'
END
WHERE role_slug IS DISTINCT FROM CASE
  WHEN role = 'admin' THEN 'admin'
  ELSE 'member'
END;
