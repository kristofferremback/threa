-- Regional mirror of WorkOS workspace authorization state.
-- Request-path auth reads only these local tables for personal API keys
-- and role display surfaces.

CREATE TABLE IF NOT EXISTS workos_workspace_authz_state (
  workspace_id TEXT PRIMARY KEY,
  workos_organization_id TEXT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workos_workspace_roles (
  workspace_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  permissions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  role_type TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS workos_workspace_memberships (
  workspace_id TEXT NOT NULL,
  organization_membership_id TEXT NOT NULL,
  workos_user_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, organization_membership_id),
  UNIQUE (workspace_id, workos_user_id)
);

CREATE TABLE IF NOT EXISTS workos_workspace_membership_roles (
  workspace_id TEXT NOT NULL,
  organization_membership_id TEXT NOT NULL,
  role_slug TEXT NOT NULL,
  position INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, organization_membership_id, role_slug),
  UNIQUE (workspace_id, organization_membership_id, position)
);

CREATE INDEX IF NOT EXISTS workos_workspace_roles_workspace_idx
  ON workos_workspace_roles (workspace_id);

CREATE INDEX IF NOT EXISTS workos_workspace_memberships_workspace_user_idx
  ON workos_workspace_memberships (workspace_id, workos_user_id);

CREATE INDEX IF NOT EXISTS workos_workspace_membership_roles_workspace_membership_idx
  ON workos_workspace_membership_roles (workspace_id, organization_membership_id, position);
