-- Add WorkOS role slug to workspace invitations.
-- Keeps the legacy admin/user compatibility column during rollout while
-- making the assigned WorkOS role explicit for in-app role assignment.

ALTER TABLE workspace_invitations
ADD COLUMN IF NOT EXISTS role_slug TEXT NOT NULL DEFAULT 'member';

UPDATE workspace_invitations
SET role_slug = CASE
  WHEN role = 'admin' THEN 'admin'
  ELSE 'member'
END
WHERE role_slug IS NULL OR role_slug = '';
