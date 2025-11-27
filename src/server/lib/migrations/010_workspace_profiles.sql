-- ============================================================================
-- Workspace-scoped User Profiles
-- ============================================================================
-- Profile data now lives on workspace_members, not users table
-- This allows users to have different profiles per workspace
-- When SSO/Directory Sync is enabled, profiles sync from IdP
-- ============================================================================

-- Add WorkOS organization ID to workspaces (for SSO-enabled workspaces)
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS workos_organization_id TEXT UNIQUE;

-- Add profile fields to workspace_members
ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Add WorkOS membership ID for Directory Sync
ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS workos_membership_id TEXT UNIQUE;

-- Track whether profile is managed by SSO (can't be edited by user)
ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS profile_managed_by_sso BOOLEAN NOT NULL DEFAULT false;

-- Index for looking up by WorkOS IDs
CREATE INDEX IF NOT EXISTS idx_workspaces_workos_org ON workspaces(workos_organization_id) WHERE workos_organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_members_workos ON workspace_members(workos_membership_id) WHERE workos_membership_id IS NOT NULL;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON COLUMN workspaces.workos_organization_id IS 'WorkOS organization ID for SSO-enabled workspaces';
COMMENT ON COLUMN workspace_members.display_name IS 'User display name in this workspace';
COMMENT ON COLUMN workspace_members.title IS 'User title/role in this workspace (e.g., Staff Engineer, CTO)';
COMMENT ON COLUMN workspace_members.avatar_url IS 'User avatar URL for this workspace';
COMMENT ON COLUMN workspace_members.workos_membership_id IS 'WorkOS organization membership ID for Directory Sync';
COMMENT ON COLUMN workspace_members.profile_managed_by_sso IS 'If true, profile is synced from IdP and cannot be edited by user';

