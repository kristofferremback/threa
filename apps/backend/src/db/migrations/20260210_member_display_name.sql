-- Add display_name to workspace_members — workspace-scoped identity, not a live join to users.
-- Backfill from users.name for existing members, then make NOT NULL.
ALTER TABLE workspace_members ADD COLUMN display_name TEXT;
UPDATE workspace_members SET display_name = u.name FROM users u WHERE u.id = workspace_members.user_id;
ALTER TABLE workspace_members ALTER COLUMN display_name SET NOT NULL;
ALTER TABLE workspace_members ALTER COLUMN display_name SET DEFAULT '';
