-- User workspace settings table
-- Stores per-user, per-workspace preferences as JSONB for flexible schema

CREATE TABLE IF NOT EXISTS user_workspace_settings (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, workspace_id)
);

-- Index for querying by workspace (admin views)
CREATE INDEX IF NOT EXISTS idx_user_workspace_settings_workspace
  ON user_workspace_settings(workspace_id)
  WHERE deleted_at IS NULL;
