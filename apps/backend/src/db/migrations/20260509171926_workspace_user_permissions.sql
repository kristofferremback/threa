-- Regional read-side mirror of WorkOS-derived authz state. Populated by CP
-- fan-out via POST /internal/authz/memberships. The control plane's
-- workos_organization_memberships table is the source of truth; this stores
-- the role slugs only, and the regional middleware expands them via
-- permissionsForRole() at request time so a code-side permission catalog
-- change takes effect without re-fanning the mirror.
--
-- Session paths read permissions from the WorkOS JWT and DO NOT consult this
-- table. INV-1: no FKs. INV-3: status validated in app code. INV-20: race-safe
-- upsert via last_event_at timestamp guard.

CREATE TABLE workspace_user_permissions (
    workspace_id TEXT NOT NULL,
    workos_user_id TEXT NOT NULL,
    role_slugs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    status TEXT NOT NULL,
    last_event_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, workos_user_id)
);

CREATE INDEX workspace_user_permissions_user_idx
    ON workspace_user_permissions (workos_user_id);
