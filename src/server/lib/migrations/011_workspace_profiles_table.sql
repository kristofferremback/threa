-- ============================================================================
-- Workspace Profiles Table
-- ============================================================================
-- Separates profile/identity data from membership/access control
-- workspace_members = access, roles, permissions, billing
-- workspace_profiles = presentation, identity, display info
-- ============================================================================

-- Create workspace_profiles table
CREATE TABLE IF NOT EXISTS workspace_profiles (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    
    -- Profile data
    display_name TEXT,
    title TEXT,
    avatar_url TEXT,
    bio TEXT,
    
    -- SSO management
    workos_membership_id TEXT UNIQUE,
    profile_managed_by_sso BOOLEAN NOT NULL DEFAULT false,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (workspace_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_workspace_profiles_user ON workspace_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_profiles_workos ON workspace_profiles(workos_membership_id) WHERE workos_membership_id IS NOT NULL;

-- Migrate existing data from workspace_members (if columns exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workspace_members' AND column_name = 'display_name') THEN
        INSERT INTO workspace_profiles (workspace_id, user_id, display_name, title, avatar_url, workos_membership_id, profile_managed_by_sso, created_at, updated_at)
        SELECT workspace_id, user_id, display_name, title, avatar_url, workos_membership_id, COALESCE(profile_managed_by_sso, false), NOW(), NOW()
        FROM workspace_members
        WHERE display_name IS NOT NULL OR title IS NOT NULL OR avatar_url IS NOT NULL
        ON CONFLICT (workspace_id, user_id) DO NOTHING;
    END IF;
END $$;

-- Drop old columns from workspace_members (keep it clean)
ALTER TABLE workspace_members DROP COLUMN IF EXISTS display_name;
ALTER TABLE workspace_members DROP COLUMN IF EXISTS title;
ALTER TABLE workspace_members DROP COLUMN IF EXISTS avatar_url;
ALTER TABLE workspace_members DROP COLUMN IF EXISTS workos_membership_id;
ALTER TABLE workspace_members DROP COLUMN IF EXISTS profile_managed_by_sso;

-- Comments
COMMENT ON TABLE workspace_profiles IS 'User profile/identity data per workspace - separate from membership';
COMMENT ON COLUMN workspace_profiles.display_name IS 'User display name in this workspace';
COMMENT ON COLUMN workspace_profiles.title IS 'User title/role (e.g., Staff Engineer, CTO)';
COMMENT ON COLUMN workspace_profiles.avatar_url IS 'User avatar URL for this workspace';
COMMENT ON COLUMN workspace_profiles.bio IS 'Short bio or description';
COMMENT ON COLUMN workspace_profiles.workos_membership_id IS 'WorkOS org membership ID for Directory Sync';
COMMENT ON COLUMN workspace_profiles.profile_managed_by_sso IS 'If true, profile synced from IdP and cannot be manually edited';

