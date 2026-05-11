# Phase 1: WorkOS Authz Mirror in Control Plane

## Context

Threa's permission model today mixes static role hierarchies (`user < admin < owner`, see `apps/backend/src/middleware/authorization.ts`) for app users with WorkOS-based scopes for API keys (`packages/types/src/api-keys.ts`, `scripts/sync-workos-permissions.ts`). PR #388 attempted to unify this end-to-end (~6.7k LOC, 113 files) and was closed without merging because the blast radius was too large to land in one go.

The unification needs to be broken into smaller, sequenced steps. **This plan covers Phase 1 only:** establish a passive WorkOS authorization mirror in the control plane that observes WorkOS state without enforcing anything yet. Nothing on the hot path changes. Once this lands, we can build write paths and regional fan-out in subsequent phases with much smaller, safer increments.

**Phase 1 outcome:**
- The existing `sync-workos-permissions.ts` becomes a true source-of-truth synchronizer (drift reporting and removal of orphan permissions, not just additive sync).
- The control plane polls WorkOS events and maintains a mirror of organization memberships, with backfill for existing workspaces and a re-runnable manual backfill script.
- The backoffice gains a members tab on the workspace detail page so we can verify the mirror is correct end-to-end.

**Explicit non-goals for Phase 1:** no write paths to WorkOS for role assignment, no fan-out to regional backends, no `viewerPermissions` in bootstrap, no `requireWorkspacePermission` middleware, no socket authz changes, no frontend role picker, no invitation `role_slug` migration, no expansion of the permission catalog beyond what's already in `packages/types/src/api-keys.ts`. All Phase 2+.

---

## Architectural Decisions

1. **Mirror lives in the control plane, not regional backends.** CP is already the only service that writes to WorkOS for orgs/memberships/invitations (`apps/control-plane/src/features/invitation-shadows/`, `apps/control-plane/src/features/workspaces/service.ts`). Putting the mirror anywhere else creates a second writer/reader of WorkOS state. The old PR's mirror tables on the regional backend were the wrong location for a phased rollout.
2. **Mirror keys on `(workos_organization_id, workos_user_id)`.** The WorkOS event payload carries the org id directly. Workspace id is derived at query time via `workspaces.workos_organization_id`. This keeps the mirror a true mirror of WorkOS state and avoids weird states if a workspace row briefly lacks an org id.
3. **Singleton polling via time-based lease, designed for multiple instances.** Mirrors the pattern in `packages/backend-common/src/outbox/cursor-lock.ts` (`locked_until` / `lock_run_id`, atomic `UPDATE ... WHERE locked_until IS NULL OR locked_until < now()`, background refresh, exponential backoff). The repo explicitly rejected `pg_advisory_lock` for this kind of work (`apps/backend/docs/distributed-cron-design.md:1167-1170`). We do **not** reuse `CursorLock` directly because (a) its cursor type is `bigint`, ours is an opaque WorkOS string, and (b) we don't need its sliding-window gap dedup (idempotency comes from event id + a `last_event_at` timestamp guard, not contiguous local IDs). New helper modeled on `CursorLock` but simpler.
4. **Backfill is re-runnable.** First server boot triggers it automatically when state is empty. A separate script (`bun workos-authz:backfill`) lets operators re-run it any time. Backfill upserts unconditionally; the regular event poller has a timestamp guard so it won't be clobbered by stale event replays.

---

## Sequencing: Three Small PRs

Each PR is independently mergeable and reversible. Land them in order.

### PR A — Sync script hardening

Self-contained changes to `scripts/sync-workos-permissions.ts` only. No runtime code touched. Lands first because it's risk-free and immediately useful.

**Modify `scripts/sync-workos-permissions.ts`:**
- Replace additive `setRolePermissions` (currently `[...existing.permissions, ...role.permissions]` PUT-as-union) with **true-replace**: `PUT` exactly the code-defined permission set, so removing a permission from `REQUIRED_ROLES` actually removes it from WorkOS.
- Add **extra/orphan permission detection** to the role drift report (today only "missing" permissions are reported).
- Add `updateRole` PATCH for role name/description sync (today only role permissions can drift in `--check`).
- Refactor: extract `detectRoleDrift(remoteRoles)` returning `{ slug, fields, missingPermissions, extraPermissions }[]`, used by both `check` and `sync`.
- **Do NOT** broaden the permission catalog (no rename to `WORKSPACE_PERMISSION_SCOPES`, no new permission slugs). That's a Phase 2 decision once the mirror is in place.

**Reference for the port:** see PR #388 diff of `scripts/sync-workos-permissions.ts` for the exact shape of `detectRoleDrift`, `updateRole`, and the true-replace `setRolePermissions` call.

**Verification:**
1. `bun workos:check` against staging — reports zero drift after a clean `bun workos:sync`.
2. Add a fake permission to `API_KEY_PERMISSIONS` locally → `bun workos:check` shows missing → `bun workos:sync` creates → remove from local → `bun workos:check` shows orphan-as-removable → `bun workos:sync` removes it from WorkOS.
3. Edit a role's `description` locally → `bun workos:check` reports the field drift → sync resolves it.
4. CI: existing workflow `.github/workflows/ci.yml:120-159` already runs `--check` on PRs touching the script.

---

### PR B — WorkOS event poller and mirror in CP

The bulk of Phase 1. New CP feature directory, one migration, two new tables, a lock helper, a poller worker, a backfill module, and stub-service additions.

#### Migration

**New: `apps/control-plane/src/db/migrations/006_workos_authz_mirror.sql`**

```sql
-- Singleton-ish poller state. PRIMARY KEY on `name` lets us add additional
-- pollers later without a schema change. Phase 1 uses one row: 'workos-events'.
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

-- Mirror of WorkOS organization memberships. Source of truth = WorkOS.
-- last_event_at is the timestamp guard for race-safe upserts (INV-20).
CREATE TABLE workos_organization_memberships (
    workos_organization_id TEXT NOT NULL,
    workos_user_id TEXT NOT NULL,
    organization_membership_id TEXT NOT NULL,
    status TEXT NOT NULL,                        -- "active" | "inactive" | "pending" (validated in app code, INV-3)
    role_slugs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    last_event_id TEXT,                          -- nullable: backfill rows have no event id
    last_event_at TIMESTAMPTZ NOT NULL,          -- backfill stamps NOW(); events stamp event.created_at
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workos_organization_id, workos_user_id)
);

CREATE INDEX workos_org_memberships_user_idx
    ON workos_organization_memberships (workos_user_id);

CREATE INDEX workos_org_memberships_org_status_idx
    ON workos_organization_memberships (workos_organization_id, status);
```

No FKs (INV-1). No DB enums (INV-3). Workspace scoping is implicit via `workspaces.workos_organization_id` join.

#### WorkOS service additions

The stub in PR #388 already drafted these shapes. Port them.

**Modify `packages/backend-common/src/auth/workos-org-service.ts`:**
- Add types: `WorkosEventSummary`, `WorkosOrganizationMembership`.
- Add interface methods on `WorkosOrgService`:
  - `listEvents(params: { events: string[]; after?: string; limit?: number }): Promise<{ data: WorkosEventSummary[]; after: string | null }>`
  - `listOrganizationMemberships(organizationId: string): Promise<WorkosOrganizationMembership[]>` (paginated; returns full result set — backfill is a low-frequency operation)
- Implement on `WorkosOrgServiceImpl` using `this.workos.events.listEvents` and `this.workos.userManagement.listOrganizationMemberships`.

**Modify `packages/backend-common/src/auth/workos-org-service.stub.ts`:**
- Add corresponding stubs (the shapes are already in the old PR's diff — copy them).

**Modify `packages/backend-common/src/index.ts`:**
- Re-export new types.

#### Lock helper

**New: `apps/control-plane/src/lib/workos-event-poller-lock.ts`**

A small lock helper modeled on `CursorLock` (`packages/backend-common/src/outbox/cursor-lock.ts`) but:
- Cursor type is `string | null` (WorkOS opaque event id), not `bigint`.
- No sliding-window dedup. WorkOS event ids are globally unique; idempotency comes from `last_event_at > stored.last_event_at` guards on upsert.
- Shape: `tryClaim()`, `refresh()`, `release()`, exponential-backoff retry on errors. Same `locked_until` / `lock_run_id` / `retry_count` / `retry_after` / `last_error` semantics.

Public API:
```ts
class WorkosEventPollerLock {
  constructor(config: {
    pool: Pool
    name: string                  // 'workos-events'
    lockDurationMs: number        // 10_000
    refreshIntervalMs: number     // 5_000
    maxRetries: number            // 5
    baseBackoffMs: number         // 1_000
  })

  // Returns null if lock unavailable or in backoff. Holder must call release().
  async tryAcquire(): Promise<{ lastEventId: string | null; lastEventAt: Date | null } | null>
  async advance(lastEventId: string, lastEventAt: Date): Promise<void>
  async recordError(message: string): Promise<{ shouldRetry: boolean }>
  async resetRetry(): Promise<void>
  async release(): Promise<void>
}
```

The refresh timer is started/stopped by the caller (the poller worker) the same way the outbox dispatcher does it in `apps/control-plane/src/server.ts`.

#### Mirror feature module

**New: `apps/control-plane/src/features/workos-authz/`** (colocated per INV-51)

- **`repository.ts`** — `WorkosAuthzRepository` with:
  - `upsertMembershipFromEvent(membership, eventId, eventCreatedAt)`: race-safe upsert using `INSERT ... ON CONFLICT (workos_organization_id, workos_user_id) DO UPDATE SET ... WHERE workos_organization_memberships.last_event_at < EXCLUDED.last_event_at` (timestamp guard, INV-20). Returns whether the row was modified.
  - `upsertMembershipFromBackfill(membership)`: unconditional upsert with `last_event_at = NOW()`, `last_event_id = NULL`. Backfill is an explicit operator action — last-write-wins is intentional.
  - `deleteMembership(orgId, userId, eventCreatedAt)`: only deletes if `last_event_at < eventCreatedAt`.
  - `listByOrganization(orgId)`, `getByUserId(workosUserId)` — read paths for the backoffice handler.

- **`service.ts`** — `WorkosAuthzService` orchestrates:
  - `processEvent(event)`: dispatch on event type to repo upsert/delete.
  - Owns the transaction boundary (INV-6).

- **`backfill.ts`** — `WorkosAuthzBackfill`:
  - `run(): Promise<{ orgsScanned: number; membershipsUpserted: number }>`
  - For each workspace with a non-null `workos_organization_id` (read via the existing workspace repo): `workosOrgService.listOrganizationMemberships(orgId)` → upsert each via `repo.upsertMembershipFromBackfill(...)`.
  - Stamp `workos_event_poller_state.last_backfill_at = NOW()`.
  - Idempotent and re-runnable. Does NOT touch `last_event_id` so the poller's cursor is unaffected.

- **`poller.ts`** — `WorkosAuthzPoller`:
  - Long-lived loop with configurable interval (default 5s) modeled on the outbox dispatcher in `apps/control-plane/src/server.ts:75-87`.
  - On each tick:
    1. `lock.tryAcquire()` → if null, skip.
    2. Start refresh timer.
    3. In a try/finally:
       - Loop: call `workosOrgService.listEvents({ events: ["organization_membership.created", "organization_membership.updated", "organization_membership.deleted"], after: lastEventId, limit: 100 })`.
       - For each event: `service.processEvent(event)` then `lock.advance(event.id, event.createdAt)`.
       - Continue until WorkOS returns no more (`after === null`).
       - On error: `lock.recordError(...)` → exponential backoff.
    4. Stop refresh timer, `lock.release()`.
  - Graceful shutdown: stop loop, wait for in-flight tick to complete (or lease to expire).

- **`index.ts`** — barrel exports the public service, poller, and backfill (INV-52).

#### Bootstrap wiring

**Modify `apps/control-plane/src/server.ts`:**
- After the existing `OutboxDispatcher` setup, construct `WorkosAuthzRepository`, `WorkosAuthzService`, `WorkosAuthzBackfill`, `WorkosEventPollerLock`, `WorkosAuthzPoller`.
- On startup, if `workos_event_poller_state` row for `name='workos-events'` is missing or `last_backfill_at IS NULL`: run backfill, then start the poller. Otherwise just start the poller.
- On shutdown, signal poller to stop and await final tick.

#### Re-runnable backfill script

**New: `apps/control-plane/scripts/backfill-workos-authz.ts`**
- Standalone Bun script that connects to the CP DB using the same config loader, constructs the service + WorkOS client, and invokes `WorkosAuthzBackfill.run()`.
- Exits with the upsert count and 0 on success, non-zero on failure.

**Modify `package.json`:**
- Add `"workos-authz:backfill": "bun apps/control-plane/scripts/backfill-workos-authz.ts"`.

#### Tests

- `apps/control-plane/src/features/workos-authz/repository.test.ts` — race-safe upsert, timestamp guard rejects stale events, delete respects guard, backfill upsert overwrites unconditionally.
- `apps/control-plane/src/features/workos-authz/service.test.ts` — event dispatch (created/updated/deleted) routes to the right repo method.
- `apps/control-plane/src/features/workos-authz/poller.test.ts` — happy path (events processed, cursor advanced), error path (records error and backs off), no-events path, lock contention (second poller instance is a no-op while first holds lock).
- `apps/control-plane/src/lib/workos-event-poller-lock.test.ts` — claim/release/refresh, lease expiry handover, retry/backoff state machine.

Use the existing stub `StubWorkosOrgService` to drive event sequences.

#### Verification

1. `bun run test --filter workos-authz` — all unit/integration tests pass.
2. **Local end-to-end with stub auth:** start CP, manipulate the stub's `memberships` map directly (test-only seam), tick the poller, observe mirror table state.
3. **Local end-to-end with real WorkOS staging:** start CP pointed at staging WorkOS, change a member's role in the WorkOS dashboard, observe `workos_organization_memberships` row update within ~5s.
4. **Concurrency test:** start two CP instances locally against the same DB. Logs show only one holds the lock per tick. No duplicate event processing (assert via row counts and the timestamp guard).
5. **Backfill re-run:** `bun run workos-authz:backfill`, idempotent, stamps `last_backfill_at`.
6. **Shutdown safety:** SIGTERM during a tick releases the lock cleanly (verify `locked_until IS NULL` post-shutdown).

---

### PR C — Backoffice "Members" tab

UI surface so we can verify the mirror visually and start trusting it before any enforcement is built on top.

#### Backend

**Modify `apps/control-plane/src/features/backoffice/service.ts`:**
- Add `listWorkspaceMembers(workspaceId)`:
  - Resolve `workos_organization_id` via the workspace repo.
  - Query `workos_organization_memberships` for that org.
  - For each row, resolve email/name via `workosOrgService.getUser(workosUserId)` (best-effort; null if user lookup fails).
  - Return `[{ workosUserId, email, firstName, lastName, status, roleSlugs, lastEventAt }]`.

**Modify `apps/control-plane/src/features/backoffice/handlers.ts`:**
- Add handler for `GET /api/backoffice/workspaces/:id/members`. Validate `:id` with Zod (INV-55). Return structured JSON, no display strings (INV-46).

**Modify `apps/control-plane/src/routes.ts`:**
- Register the new route under `requirePlatformAdmin`.

#### Frontend (backoffice SPA)

Use the `frontend-design` skill for the visual layer.

**New tab on workspace detail page** in `apps/backoffice/src/...` (exact path to be confirmed when this PR is drafted; the existing workspace detail page is the entry point per `docs/system-overview.md:200-205`).
- Editorial vocabulary matching the rest of backoffice: uppercase eyebrow label, `divide-y border-y` rows, single `max-w-5xl` width.
- Each row: name + email, role-slug chips, status badge, "last sync" timestamp (`lastEventAt`).
- Empty state: "No members yet — backfill may still be running."
- TanStack Query for fetch.

#### Tests

- `handlers.test.ts` — members endpoint returns expected shape, 403 for non-admin.
- Frontend integration test for the tab (mounts real component, exercises observable behavior, INV-39).

#### Verification

1. Log in as platform admin → workspace detail page → members tab → see actual members with their WorkOS roles.
2. Change a member's role in WorkOS dashboard → wait ~5s → refresh tab → role reflects new state.
3. Hit `GET /api/backoffice/workspaces/:id/members` directly with a non-admin session → 403.

---

## Critical Files Map

### PR A
- `scripts/sync-workos-permissions.ts` (modify)

### PR B
**New:**
- `apps/control-plane/src/db/migrations/006_workos_authz_mirror.sql`
- `apps/control-plane/src/lib/workos-event-poller-lock.ts`
- `apps/control-plane/src/lib/workos-event-poller-lock.test.ts`
- `apps/control-plane/src/features/workos-authz/index.ts`
- `apps/control-plane/src/features/workos-authz/repository.ts`
- `apps/control-plane/src/features/workos-authz/repository.test.ts`
- `apps/control-plane/src/features/workos-authz/service.ts`
- `apps/control-plane/src/features/workos-authz/service.test.ts`
- `apps/control-plane/src/features/workos-authz/backfill.ts`
- `apps/control-plane/src/features/workos-authz/poller.ts`
- `apps/control-plane/src/features/workos-authz/poller.test.ts`
- `apps/control-plane/scripts/backfill-workos-authz.ts`

**Modify:**
- `packages/backend-common/src/auth/workos-org-service.ts` (add `listEvents`, `listOrganizationMemberships`, types)
- `packages/backend-common/src/auth/workos-org-service.stub.ts` (port stubs from PR #388)
- `packages/backend-common/src/index.ts` (re-export types)
- `apps/control-plane/src/server.ts` (wire up backfill + poller alongside outbox dispatcher)
- `package.json` (`workos-authz:backfill` script)

### PR C
**Modify:**
- `apps/control-plane/src/features/backoffice/service.ts`
- `apps/control-plane/src/features/backoffice/handlers.ts`
- `apps/control-plane/src/features/backoffice/handlers.test.ts`
- `apps/control-plane/src/routes.ts`

**New (paths confirmed during PR C planning):**
- Members tab component in `apps/backoffice/src/`
- Component test

---

## Reused Existing Code

- **Lease/lock pattern:** modeled on `CursorLock` in `packages/backend-common/src/outbox/cursor-lock.ts`. Same `locked_until` / `lock_run_id` / refresh-timer / exponential-backoff semantics. Not reused directly because cursor type differs and we don't need the sliding window.
- **Long-lived worker bootstrap:** modeled on the outbox dispatcher in `apps/control-plane/src/server.ts:75-87`.
- **WorkOS SDK wrapper:** extend `WorkosOrgService` / `WorkosOrgServiceImpl` in `packages/backend-common/src/auth/workos-org-service.ts`.
- **Stub auth service:** `StubWorkosOrgService` in `packages/backend-common/src/auth/workos-org-service.stub.ts` (PR #388 drafted the new method shapes — port them).
- **Backoffice patterns:** `BackofficeService` and `requirePlatformAdmin` middleware in `apps/control-plane/src/features/backoffice/`.
- **DB helpers:** `withClient`, `withTransaction`, `sql` template tag, `createDatabasePool` from `@threa/backend-common`.
- **CI:** `.github/workflows/ci.yml:120-159` already runs `workos:check` on PR and `workos:sync` on main — PR A's improvements automatically benefit from this.

---

## End-to-End Verification

After all three PRs are merged:

1. **Sync hardening (PR A):**
   - `bun workos:check` reports zero drift in CI on green PRs.
   - Removing a permission from `API_KEY_PERMISSIONS` and merging actually removes it from WorkOS staging.

2. **Mirror correctness (PR B):**
   - On first deploy: backfill runs once, `workos_organization_memberships` populated for every workspace, `workos_event_poller_state.last_backfill_at` stamped.
   - Steady state: poller log line every ~5s, `last_event_id` advances when membership changes occur.
   - `bun run workos-authz:backfill` re-syncs without errors.
   - Restart CP: poller resumes from `last_event_id` without backfilling again.
   - Two CP instances pointed at the same DB: only one holds the lock per tick.

3. **Backoffice visibility (PR C):**
   - Platform admin can navigate to any workspace's detail page and see live members + roles.
   - Role change in WorkOS dashboard reflects in the UI within ~5s.

If all three pass, Phase 1 is done and Phase 2 (write paths and regional fan-out) can be planned with the mirror as a stable foundation.
