-- WorkOS organization link on workspaces (lazy — populated on first invitation)
ALTER TABLE workspaces ADD COLUMN workos_organization_id TEXT;
CREATE INDEX idx_workspaces_workos_org
  ON workspaces (workos_organization_id) WHERE workos_organization_id IS NOT NULL;

-- Workspace invitations table
CREATE TABLE workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by TEXT NOT NULL,
  workos_invitation_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_workspace_invitations_workspace_status
  ON workspace_invitations (workspace_id, status);
CREATE INDEX idx_workspace_invitations_email_status
  ON workspace_invitations (email, status);
CREATE INDEX idx_workspace_invitations_workos_id
  ON workspace_invitations (workos_invitation_id) WHERE workos_invitation_id IS NOT NULL;

-- Member setup tracking — new members from invitations start incomplete
ALTER TABLE workspace_members ADD COLUMN setup_completed BOOLEAN NOT NULL DEFAULT TRUE;
