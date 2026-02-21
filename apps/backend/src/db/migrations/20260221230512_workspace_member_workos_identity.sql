-- Move WorkOS identity to workspace_members and remove global users table.
-- Each WorkOS user can have multiple members (one per workspace).

-- Add workspace-scoped identity fields.
ALTER TABLE workspace_members ADD COLUMN workos_user_id TEXT;
ALTER TABLE workspace_members ADD COLUMN email TEXT;

-- Backfill from legacy users table.
UPDATE workspace_members wm
SET workos_user_id = u.workos_user_id,
    email = u.email
FROM users u
WHERE wm.user_id = u.id;

-- Enforce required identity fields.
ALTER TABLE workspace_members ALTER COLUMN workos_user_id SET NOT NULL;
ALTER TABLE workspace_members ALTER COLUMN email SET NOT NULL;

-- Rebuild keys and indexes around WorkOS identity.
ALTER TABLE workspace_members DROP CONSTRAINT workspace_members_pkey;
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);
ALTER TABLE workspace_members
  ADD CONSTRAINT workspace_members_ws_workos_user_key UNIQUE (workspace_id, workos_user_id);

DROP INDEX IF EXISTS idx_workspace_members_user;
CREATE INDEX idx_workspace_members_workos_user ON workspace_members (workos_user_id);
CREATE INDEX idx_workspace_members_workspace_email ON workspace_members (workspace_id, email);
CREATE INDEX IF NOT EXISTS idx_workspace_members_name_trgm ON workspace_members USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_workspace_members_email_trgm ON workspace_members USING GIN (email gin_trgm_ops);

-- Drop legacy user reference and global users table.
ALTER TABLE workspace_members DROP COLUMN user_id;
DROP TABLE users;
