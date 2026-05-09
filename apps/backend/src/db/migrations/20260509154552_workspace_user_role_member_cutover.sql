UPDATE users
SET role = 'member'
WHERE role = 'user';

UPDATE workspace_invitations
SET role = 'member'
WHERE role = 'user';

ALTER TABLE users
ALTER COLUMN role SET DEFAULT 'member';

ALTER TABLE workspace_invitations
ALTER COLUMN role SET DEFAULT 'member';
