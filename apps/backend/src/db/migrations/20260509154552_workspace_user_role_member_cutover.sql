-- Rename workspace user role from "user" to "member" everywhere it is persisted.
-- One-shot cutover; the application code now only accepts "owner" | "admin" | "member".

UPDATE users
SET role = 'member'
WHERE role = 'user';

UPDATE workspace_invitations
SET role = 'member'
WHERE role = 'user';
