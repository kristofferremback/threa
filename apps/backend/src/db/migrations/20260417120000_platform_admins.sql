-- Platform-admin mirror of the control-plane's platform_roles table.
--
-- Presence = this WorkOS user has control-panel access. Intentionally not
-- workspace-scoped (INV-8 global-only exception, like auth sessions): platform
-- admin status is an identity-level property, not a workspace concern. The
-- control plane is the source of truth; rows here are written by internal
-- pushes and a boot-time reconcile sweep.

CREATE TABLE IF NOT EXISTS platform_admins (
  workos_user_id TEXT PRIMARY KEY,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
