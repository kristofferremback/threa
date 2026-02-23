-- Rename workspace role value from "member" to "user".
-- Aligns persisted data/defaults with runtime role constants and validation.

UPDATE users
SET role = 'user'
WHERE role = 'member';

ALTER TABLE users
ALTER COLUMN role SET DEFAULT 'user';

UPDATE workspace_invitations
SET role = 'user'
WHERE role = 'member';

ALTER TABLE workspace_invitations
ALTER COLUMN role SET DEFAULT 'user';

-- Normalize historical actor/author type values to the current "user" literal.
UPDATE messages
SET author_type = 'user'
WHERE author_type = 'member';

UPDATE stream_events
SET actor_type = 'user'
WHERE actor_type = 'member';

UPDATE member_activity
SET actor_type = 'user'
WHERE actor_type = 'member';
