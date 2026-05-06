-- WorkOS authz mirror — passive read-side mirror of organization memberships
-- driven by WorkOS event polling.
--
-- Design notes:
-- - Keys on (workos_organization_id, workos_user_id) so the table is a true
--   mirror of WorkOS state. Workspace scoping is implicit via the join to
--   workspace_registry.workos_organization_id when callers need it.
-- - last_event_at is the timestamp guard for race-safe upserts (INV-20):
--   regular event upserts use a `WHERE existing.last_event_at < EXCLUDED.last_event_at`
--   guard so out-of-order or duplicated events never clobber newer state.
--   Backfill stamps NOW() and last_event_id = NULL — backfill is an explicit
--   operator action, last-write-wins is intentional there.
-- - status is TEXT (validated in app code, INV-3): 'active' | 'inactive' | 'pending'.
-- - role_slugs is TEXT[] so we can mirror WorkOS' multi-role membership shape
--   even though Phase 1 still has a single role per membership in practice.
-- - workos_event_poller_state is keyed by `name` so additional pollers can be
--   added later without a schema change. Phase 1 uses one row: 'workos-events'.

CREATE TABLE workos_event_poller_state (
    name TEXT PRIMARY KEY,
    last_event_id TEXT,
    last_event_at TIMESTAMPTZ,
    last_backfill_at TIMESTAMPTZ,
    locked_until TIMESTAMPTZ,
    lock_run_id TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    retry_after TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workos_organization_memberships (
    workos_organization_id TEXT NOT NULL,
    workos_user_id TEXT NOT NULL,
    organization_membership_id TEXT NOT NULL,
    status TEXT NOT NULL,
    role_slugs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    last_event_id TEXT,
    last_event_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workos_organization_id, workos_user_id)
);

CREATE INDEX workos_org_memberships_user_idx
    ON workos_organization_memberships (workos_user_id);

CREATE INDEX workos_org_memberships_org_status_idx
    ON workos_organization_memberships (workos_organization_id, status);
