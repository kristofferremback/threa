-- Track the assigned WorkOS role slug on invitation shadows so the
-- accepted membership can be recreated in WorkOS with the intended role.

ALTER TABLE invitation_shadows
ADD COLUMN IF NOT EXISTS role_slug TEXT NOT NULL DEFAULT 'member';
