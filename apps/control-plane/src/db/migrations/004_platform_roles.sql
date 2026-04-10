-- Platform-level role assignments, independent of WorkOS organization memberships.
-- Grants access to the backoffice app (administer workspaces, invite workspace
-- owners, billing, etc.). Expected to stay tiny — only Threa employees/operators.
--
-- Design notes:
-- - Keyed by workos_user_id (the stable identity the control-plane already trusts
--   via WorkOS sessions). No FK per INV-1.
-- - role is TEXT with values validated in application code per INV-3.
--   Initial value: 'admin'. Future: 'support', 'billing', etc.
-- - A user has at most one platform role (no array of roles) — keeps lookup/gate
--   logic trivially simple. If we ever need multi-role, switch to a join table.

CREATE TABLE platform_roles (
    workos_user_id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
