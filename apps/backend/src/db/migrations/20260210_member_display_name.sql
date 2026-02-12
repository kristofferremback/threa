-- Add name to workspace_members — workspace-scoped identity, not a live join to users.
-- Backfill from users.name for existing members, then make NOT NULL.
ALTER TABLE workspace_members ADD COLUMN name TEXT;
UPDATE workspace_members SET name = u.name FROM users u WHERE u.id = workspace_members.user_id;
UPDATE workspace_members SET name = '' WHERE name IS NULL;
ALTER TABLE workspace_members ALTER COLUMN name SET NOT NULL;
ALTER TABLE workspace_members ALTER COLUMN name SET DEFAULT '';
