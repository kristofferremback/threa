# Phase 2: WorkOS Authz Write Paths, Regional Fan-Out, and Enforcement

## Context

Phase 1 (`/home/user/threa/.claude/plans/1-yes-please-backfill-async-sky.md`, PRs #477 / #478 / #479) established a passive WorkOS authorization mirror in the control plane. Nothing on the regional hot path changed: regional backends still gate behavior on the static `user < admin < owner` hierarchy in `apps/backend/src/middleware/authorization.ts`, the bootstrap response carries no permission information, and there are no write paths from us back to WorkOS.

**Phase 2 outcome:** the WorkOS mirror becomes the source of truth for workspace authorization at runtime. Regional backends learn membership/role state via CP fan-out and enforce a permission catalog instead of a role hierarchy. The frontend gets `viewerPermissions` and a role-picker UI. Invitations carry a role slug that survives the accept round-trip. Write paths from CP back to WorkOS allow operators (and admins) to assign, change, and remove roles.

**Explicit non-goals for Phase 2:** no changes to the API-key permission model beyond extending the catalog (the public-API auth in `apps/backend/src/middleware/public-api-auth.ts` keeps reading `API_KEY_SCOPES`); no SCIM; no per-resource (per-stream / per-bot) permissions — those stay on whatever scoping they have today; no removal of the `users.role` column (kept as a denormalized cache for the lifetime of Phase 2 — purge happens later once we're confident the new path is stable). No Phase 1 reversal: the mirror, poller, backfill, and backoffice tab continue to operate exactly as they do.

---

## Architectural Decisions

These mirror the shape of Phase 1's decisions and lock in the contracts each PR depends on.

1. **Permission catalog is a single TypeScript source of truth in `packages/types/`.** A new `packages/types/src/workspace-permissions.ts` defines `WORKSPACE_PERMISSIONS` (an array of `{ slug, name, description }` matching the existing `ApiKeyPermission` shape) and `WORKSPACE_ROLE_DEFINITIONS` (the `RoleDefinition[]` currently inlined in `scripts/sync-workos-permissions.ts`). The sync script imports from there instead of defining `REQUIRED_ROLES` itself. WorkOS dashboard permissions are identical strings — slug equality is the contract. This keeps the catalog colocated with `API_KEY_PERMISSIONS` (INV-51 reading: `packages/types/` is the cross-cutting feature) and trivially shareable to frontend without a new package.

2. **Fan-out reuses the CP outbox pattern, with new event types — not a new transport.** Phase 1 added a poller that writes to CP. Phase 2 adds outbox events emitted from `WorkosAuthzService.processEvent` (and from the write paths in PR-4 below) that the existing `dispatchEvent` switch in `apps/control-plane/src/server.ts:251-266` routes to a new `RegionalAuthzFanOut` service. That service calls a new `RegionalClient.syncMembership(...)` method, which posts to a new regional `POST /internal/authz/memberships` endpoint. This is the same shape as `OUTBOX_REGIONAL_CREATE` → `regionalClient.createWorkspace` and gives us free durability, retries, and DLQ via the existing `CursorLock`. Two new event types: `authz_membership_changed` and `authz_membership_removed`.

3. **Regional mirror table is denormalized for query patterns; not a 1:1 copy of CP's table.** CP's `workos_organization_memberships` is keyed on `(workos_organization_id, workos_user_id)`. Regional doesn't naturally know `workos_organization_id` for most queries — every authorization check happens by `(workspace_id, user_id)`. The regional table `workspace_user_permissions` keys on `(workspace_id, workos_user_id)` and stores a denormalized `permission_slugs TEXT[]` (computed by CP from `role_slugs` × the role definitions in the catalog) plus the list of `role_slugs` for display. Storing the resolved permission set on regional means the hot-path middleware does one indexed lookup, no role→permission expansion at request time. This costs one additional fan-out event when the catalog itself changes, but the catalog only changes at deploy time (PR-1), so the cost is negligible.

4. **Migration strategy: dual-read with feature flag, then flag flip, then code removal in Phase 3.** PR-3 introduces `requireWorkspacePermission(slug)` and `viewerPermissions` but keeps `requireRole(...)` working. A config flag `WORKSPACE_AUTHZ_USE_PERMISSIONS` (default `false` initially) controls whether `requireRole` falls back to permission-based check or stays on role hierarchy. Routes get migrated one-at-a-time in follow-up commits (still inside PR-3) by replacing `requireRole("admin")` with `requireWorkspacePermission("workspace:invitations:manage")` (or whatever applies). Once every callsite is migrated and flag-flipped to `true` in staging+prod, Phase 3 deletes `requireRole`. Hard cutover was rejected because regional has 25+ `requireRole("admin")` sites — flag-gated dual-read keeps PR-3 reviewable.

5. **Invitation `role_slug` lives in both `workspace_invitations` (regional) and `invitation_shadows` (CP), denormalized.** When CP issues a WorkOS invitation, the role is already implicit (we always pass `roleSlug: "admin"` or `"member"` today in `apps/control-plane/src/features/invitation-shadows/service.ts:121` and `apps/control-plane/src/features/workspaces/service.ts:160`). Phase 2 makes the role explicit on creation: regional creates the row with `role_slug`, emits `invitation:sent` with `roleSlug` in the payload, the existing `InvitationShadowSyncHandler` carries it to CP via the existing `ControlPlaneClient.createInvitationShadow`, CP stores it on `invitation_shadows`. On accept, regional creates the user row with the full role set derived from `role_slug`, and CP's existing `ensureOrganizationMembership` uses `roleSlug` (already a parameter — Phase 2 just stops hard-coding `"admin"` / `"member"`). No migration of historical pending invitations: they keep their existing `role` column ("admin" | "user"), and a translation function maps them onto WorkOS slugs at accept time.

6. **Socket authz is a thin layer over the new HTTP middleware.** No new infrastructure. The existing socket join handler in `apps/backend/src/socket.ts:130` already calls `UserRepository.findByWorkosUserIdInWorkspace` — Phase 2 adds an optional `requiredPermission?: string` parameter to specific room patterns (none currently — workspace and stream rooms gate on membership/stream access, both of which remain). The visible new check is on bot/agent-session rooms where moderation actions might broadcast: bot rooms already gate on `requireRole("admin")` HTTP-side; if we add a future "watch bot key activity" socket, this is the hook. Phase 2 ships the helper but only one callsite (TBD during PR-6).

---

## Sequencing: Six Small PRs

Land in order. Each is independently mergeable and reversible. Dependencies between them are stated explicitly.

### PR-1 — Permission catalog + role definitions in `@threa/types`

**Goal.** Centralize the workspace-permission slugs and role-to-permission map in `packages/types/` so every other PR can import from one place. Nothing consumes the new exports yet; this PR is foundation.

**Depends on.** Nothing.

**Migration.** None (this is types-only).

**New / modified files.**
- New: `packages/types/src/workspace-permissions.ts`. Exports:
  - `WORKSPACE_PERMISSION_SLUGS` (`as const` array of `"workspace:invitations:manage" | "workspace:bots:manage" | "workspace:integrations:manage" | "workspace:budget:manage" | "workspace:members:manage" | "workspace:members:assign-role"`).
  - `type WorkspacePermissionSlug` derived from the array.
  - `WORKSPACE_PERMISSIONS: ApiKeyPermission[]`-shaped array with `{ slug, name, description }` for each. Same shape as `API_KEY_PERMISSIONS` in `packages/types/src/api-keys.ts` so the WorkOS sync script can treat both lists uniformly.
  - `WORKSPACE_ROLE_SLUGS = ["owner", "admin", "member"] as const` (note: WorkOS uses `member`, regional currently uses `user` — the catalog speaks WorkOS, regional translates via `legacyRoleToWorkos` / `workosRoleToLegacy` helpers in this same file, exported but undocumented to discourage new use).
  - `WORKSPACE_ROLE_DEFINITIONS: RoleDefinition[]` keyed by slug, listing the permissions each role has.
- Modify: `packages/types/src/index.ts` — add the new exports under a "Workspace Permissions" section (INV-52 — barrel through the package root).
- Modify: `scripts/sync-workos-permissions.ts` — replace the inline `REQUIRED_ROLES` and the implicit single-permission catalog with imports from `@threa/types`. The WorkOS dashboard sync now manages both API-key permissions and workspace permissions in one pass. `detectDrift` gets a second source list; `detectRoleDrift` reads roles from the catalog directly.

**Public API surface.**
```ts
export const WORKSPACE_PERMISSION_SLUGS = [...] as const
export type WorkspacePermissionSlug = (typeof WORKSPACE_PERMISSION_SLUGS)[number]
export interface WorkspaceRoleDefinition {
  slug: "owner" | "admin" | "member"
  name: string
  description: string
  permissions: WorkspacePermissionSlug[]
}
export const WORKSPACE_ROLE_DEFINITIONS: WorkspaceRoleDefinition[]
```

**Tests.**
- `packages/types/src/workspace-permissions.test.ts` — sanity: every permission referenced in `WORKSPACE_ROLE_DEFINITIONS` is in `WORKSPACE_PERMISSION_SLUGS`; owner ⊇ admin ⊇ member as a sanity floor (this is the *only* place we still assert hierarchy and it's a test, not runtime logic).
- `scripts/sync-workos-permissions.test.ts` (or extend existing) — drift detection treats the new permissions and roles correctly; a missing workspace permission reports as missing, a stale role description reports as stale.

**Verification.**
1. `bun workos:check` against staging — reports drift for every new workspace permission and role-definition update.
2. `bun workos:sync` on staging — creates the new permissions, attaches them to admin/owner roles, leaves member alone.
3. `bun run typecheck` — passes; no consumers yet.

**Does NOT.** Wire any runtime code to the catalog. Migrate any `requireRole` callsite. Affect `users.role` column. Touch frontend.

**Reviewer note.** This PR will fail `workos:check` in CI on the same PR — that's expected and tells the reviewer the staging dashboard needs a follow-up `bun workos:sync` after merge. The merge-to-main step in `.github/workflows/ci.yml:120-159` already handles that automatically.

---

### PR-2 — CP→regional fan-out of mirror state

**Goal.** Stand up a regional `workspace_user_permissions` table and a CP fan-out path that pushes mirror state into it via the existing outbox infrastructure. Nothing reads or enforces using this table yet — it's purely observational, like Phase 1's CP mirror was.

**Depends on.** PR-1 (uses `WORKSPACE_ROLE_DEFINITIONS` to expand role slugs into permission slugs CP-side before sending).

**Migrations (INV-17 — append-only).**

Regional. New file `apps/backend/src/db/migrations/<timestamp>_workspace_user_permissions.sql`:
```sql
-- Regional read-side mirror of WorkOS-derived authz state. Populated by CP
-- fan-out via the new POST /internal/authz/memberships endpoint. Source of
-- truth lives in the control plane's workos_organization_memberships table;
-- this denormalizes role_slugs into permission_slugs for hot-path lookup.
--
-- INV-1: no FKs (workspace_id, workos_user_id resolved by app code).
-- INV-3: status validated in app code.
-- INV-20: race-safe upsert via last_event_at timestamp guard.

CREATE TABLE workspace_user_permissions (
    workspace_id TEXT NOT NULL,
    workos_user_id TEXT NOT NULL,
    role_slugs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    permission_slugs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    status TEXT NOT NULL,
    last_event_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, workos_user_id)
);

CREATE INDEX workspace_user_permissions_user_idx
    ON workspace_user_permissions (workos_user_id);
```
No FKs (INV-1). No DB enums (INV-3). PK on `(workspace_id, workos_user_id)` matches the regional query pattern (decision 3).

**New / modified files.**

CP side:
- New: `apps/control-plane/src/features/workos-authz/fan-out.ts`. `RegionalAuthzFanOut` class with:
  - `expandPermissions(roleSlugs: string[]): string[]` — uses `WORKSPACE_ROLE_DEFINITIONS` from `@threa/types` to produce a deduped permission list.
  - `syncMembership(workspaceId, region, payload)` and `removeMembership(workspaceId, region, payload)` — call the existing `RegionalClient` (extended below).
  - One outbox handler method per event type, dispatched from `apps/control-plane/src/server.ts:dispatchEvent`.
- Modify: `apps/control-plane/src/features/workos-authz/service.ts` — after every successful upsert/delete, write an outbox event:
  - On upsert: `OutboxRepository.insert(client, "authz_membership_changed", { workosOrganizationId, workosUserId, roleSlugs, status, lastEventAt })`.
  - On delete: `OutboxRepository.insert(client, "authz_membership_removed", { workosOrganizationId, workosUserId, eventCreatedAt })`.
  - Both committed in the same transaction as the mirror upsert/delete (move the two repo calls into `withTransaction(this.pool, ...)` — they were row-atomic before but the outbox guarantee requires a tx).
- Modify: `apps/control-plane/src/features/workos-authz/backfill.ts` — after each successful org snapshot reconcile, emit one outbox event per surviving membership and one per reconciled-deleted membership. Backfill must fan out, otherwise regional state would diverge after operator backfill.
- Modify: `apps/control-plane/src/features/workspaces/index.ts` — re-export the new outbox event-type constants.
- Modify: `apps/control-plane/src/server.ts` — extend `dispatchEvent` switch with two new cases routing to `RegionalAuthzFanOut`. Construct it in `startServer` alongside the existing `WorkosAuthzService`.
- Modify: `apps/control-plane/src/lib/regional-client.ts` — add:
  ```ts
  async syncWorkspaceMembership(region, payload: {
    workspaceId: string
    workosUserId: string
    roleSlugs: string[]
    permissionSlugs: string[]
    status: string
    lastEventAt: Date
  }): Promise<void>
  async removeWorkspaceMembership(region, payload: {
    workspaceId: string
    workosUserId: string
    eventCreatedAt: Date
  }): Promise<void>
  ```
  Both POST to `/internal/authz/memberships` (single endpoint with a `kind: "upsert" | "remove"` discriminator works fine — matches `RegionalClient.acceptInvitation`'s style).

CP→regional resolution:
- Modify: `apps/control-plane/src/features/workspaces/repository.ts` — add `listWorkspaceIdsByWorkosOrganizationId(orgId): Promise<{ id, region }[]>`. The fan-out service needs this because mirror events are keyed on org id but regional needs workspace id. A single org can in principle map to multiple workspaces during a transition, so we return a list and emit one fan-out event per workspace.

Regional side:
- New: `apps/backend/src/features/workspace-authz/` (INV-51 — colocated feature):
  - `repository.ts`: `WorkspaceUserPermissionsRepository` with `upsert(payload)` (timestamp-guarded, INV-20), `delete(payload)` (timestamp-guarded), `getByWorkspaceAndUser(workspaceId, workosUserId)`, `listByWorkspace(workspaceId)`.
  - `service.ts`: `WorkspaceAuthzService.applyMembershipChange(payload)` and `applyMembershipRemoval(payload)`. Owns transaction boundary (INV-6).
  - `handlers.ts`: `POST /internal/authz/memberships` handler with Zod validation (INV-55). Discriminates on `kind`; routes to service.
  - `index.ts`: barrel exports (INV-52).
- Modify: `apps/backend/src/routes.ts` — register `app.post("/internal/authz/memberships", internalAuth, authz.handle)`.
- Modify: `apps/backend/src/server.ts` — construct the service and pass to route registration.

**Public API surface.**

Outbox payloads (typed in `apps/control-plane/src/features/workos-authz/index.ts`):
```ts
export interface AuthzMembershipChangedPayload {
  workosOrganizationId: string
  workosUserId: string
  roleSlugs: string[]
  status: "active" | "inactive" | "pending"
  lastEventAt: string  // ISO
}
export interface AuthzMembershipRemovedPayload {
  workosOrganizationId: string
  workosUserId: string
  eventCreatedAt: string  // ISO
}
```

Internal HTTP shape (`POST /internal/authz/memberships`):
```ts
{ kind: "upsert", workspaceId, workosUserId, roleSlugs, permissionSlugs, status, lastEventAt }
| { kind: "remove", workspaceId, workosUserId, eventCreatedAt }
```

**Tests.**
- CP: `apps/control-plane/src/features/workos-authz/fan-out.test.ts` — verifies `expandPermissions` against the catalog, that one outbox event per workspace is emitted when an org maps to multiple workspaces, that the existing dispatcher routes events correctly.
- CP: extend `apps/control-plane/src/features/workos-authz/service.test.ts` — outbox event committed in the same tx as the mirror update; rollback on tx failure.
- CP: extend `apps/control-plane/src/features/workos-authz/backfill.test.ts` — emits fan-out events for surviving and reconciled-deleted memberships.
- Regional: `apps/backend/src/features/workspace-authz/repository.test.ts` — timestamp guard upsert/delete (INV-20), idempotent replay, stale event ignored.
- Regional: `apps/backend/src/features/workspace-authz/service.test.ts` — service routes correctly; transaction boundaries.
- Regional: `apps/backend/src/features/workspace-authz/handlers.test.ts` — Zod schema rejects malformed payloads, internal-auth header required, both `kind` variants reach the right method.
- Integration: spin up CP+regional with stubs, push a mirror event to the WorkOS stub, assert regional row appears within ~5s.

**Verification.**
1. `bun run test --filter workspace-authz` and `--filter workos-authz` — green.
2. **Local:** start CP+regional+stubs, change a membership in `StubWorkosOrgService.pushMirrorEvent`, observe the regional `workspace_user_permissions` row appear with expanded permissions.
3. **Staging:** change a member's role in WorkOS dashboard, watch CP outbox dispatch, watch regional row update. Roundtrip ≤ 10s.
4. **Re-runnable backfill:** `bun workos-authz:backfill` on staging; regional rows are recreated for every membership.
5. **Failure injection:** kill regional during fan-out; CP outbox retries via `CursorLock` exponential backoff. Restart regional; events drain.

**Does NOT.** Read from the new regional table from any request handler. Change role hierarchy. Add `viewerPermissions`. Modify invitations.

**Reviewer note.** Backfill emits a fan-out event for *every* surviving membership (potentially thousands across a tenant). For staging this is fine; for production the operator should run backfill during a maintenance window and watch outbox depth. Mention this in the PR description.

---

### PR-3 — `requireWorkspacePermission` middleware + `viewerPermissions` in bootstrap

**Goal.** Regional starts enforcing WorkOS-derived permissions on a per-route basis. Frontend gets the permission set to render permission-aware UI. Old `requireRole` keeps working — it's flag-gated, dual-read, default-off.

**Depends on.** PR-2 (regional `workspace_user_permissions` table populated). PR-1 (catalog).

**Migration.** None.

**New / modified files.**

Regional middleware:
- New: `apps/backend/src/middleware/workspace-permission.ts`. `requireWorkspacePermission(slug: WorkspacePermissionSlug): RequestHandler` reads `req.workspaceId` and `req.workosUserId`, looks up the permission set via `WorkspaceUserPermissionsRepository.getByWorkspaceAndUser`, returns 403 if missing the slug. Cache-friendly: one indexed query per request.
- Modify: `apps/backend/src/middleware/authorization.ts` — `requireRole(minimumRole)` becomes flag-aware:
  - If `WORKSPACE_AUTHZ_USE_PERMISSIONS=false` (default): existing hierarchy (zero behavior change).
  - If `true`: looks up permissions via the new repo and checks against a per-role-string mapped set (`"admin" → "workspace:invitations:manage"` etc.) computed once at module load from the catalog. This is a transitional shim so the flag flip doesn't require touching every callsite simultaneously.
- Modify: `apps/backend/src/config.ts` (or wherever) — add `workspaceAuthzUsePermissions: boolean` from env.

Bootstrap:
- Modify: `apps/backend/src/features/workspaces/handlers.ts` `bootstrap` handler (`apps/backend/src/features/workspaces/handlers.ts:118`) — add a `viewerPermissions: string[]` field to the response, populated from `WorkspaceUserPermissionsRepository.getByWorkspaceAndUser(req.workspaceId, req.workosUserId)`. If the row is absent (race during onboarding), fall back to expanding `req.user.role` via `WORKSPACE_ROLE_DEFINITIONS` so the UI is never empty during the first ~5s after invite acceptance.
- Modify: `packages/types/src/api.ts` — extend `WorkspaceBootstrap` interface:
  ```ts
  viewerPermissions: WorkspacePermissionSlug[]
  ```

Frontend wire-up (read-only consumption — picker UI is PR-6):
- Modify: `apps/frontend/src/api/workspaces.ts` — type the new field via the updated `WorkspaceBootstrap`.
- Modify: `apps/frontend/src/components/workspace-settings/users-tab.tsx` (line 138-140), `apps/frontend/src/components/stream-settings/members-tab.tsx` (line 55), `apps/frontend/src/components/workspace-settings/integrations-tab.tsx` (line 24) — switch the `currentWorkspaceUser?.role === "admin" || ...` gates to `viewerPermissions.includes("workspace:...")`. Keep the `Badge` display text reading `user.role` (it's still the persisted role). This is a frontend-only swap from role to permission for visibility-gating.
- New: `apps/frontend/src/lib/permissions.ts` — small helper `hasPermission(viewerPermissions, slug)` for readable callsites.

Per-route migration (incremental within this PR, one commit per logical area, all in one PR):
- `routes.ts:299-313` (invitations) — `requireRole("admin")` → `requireWorkspacePermission("workspace:invitations:manage")`.
- `routes.ts:331` (AI budget) — `requireWorkspacePermission("workspace:budget:manage")`.
- `routes.ts:387-399` (integrations) — `requireWorkspacePermission("workspace:integrations:manage")`.
- `routes.ts:415-466` (bots) — `requireWorkspacePermission("workspace:bots:manage")`.
- `apps/backend/src/features/workspace-integrations/service.ts:191` (the in-service role check) — replace with the same permission lookup. Service-layer permission check helper added to `WorkspaceUserPermissionsRepository` (`hasPermission(workspaceId, workosUserId, slug)`) so callers don't need the middleware path.
- `apps/backend/src/features/workspaces/handlers.ts:194-196` (bootstrap inviting flag) — replace `userRole === "admin" || ...` with `viewerPermissions.includes("workspace:invitations:manage")`.
- `apps/backend/src/features/streams/handlers.ts:772` (stream actor check) — replace inline role check with permission lookup.
- `apps/backend/src/features/commands/invite-command.ts:59` (canInviteBots) — same.
- `apps/backend/src/features/system-messages/service.ts:80` (find owners for notifications) — leave alone; this is a notification-targeting query, not authorization. Document the exception in a code comment.
- `apps/backend/src/features/public-api/handlers.ts:146` (`role: user.role` returned in API response) — leave alone; public API consumers depend on it. Document.

Routes left on `requireRole` after PR-3 (intentional — Phase 3 cleanup): zero. PR-3's job is to migrate them all but keep `requireRole` shimmed, behind the flag.

**Public API surface.**
- New middleware: `requireWorkspacePermission(slug)`.
- New `WorkspaceBootstrap.viewerPermissions: WorkspacePermissionSlug[]`.
- New repo method `WorkspaceUserPermissionsRepository.hasPermission(workspaceId, workosUserId, slug): Promise<boolean>` for service-layer use.

**Tests.**
- `apps/backend/src/middleware/workspace-permission.test.ts` — 401 unauthenticated, 403 when permission missing, 200 when present, falls back to row-absent behavior described above (and logs a warning so we can detect drift). Mirrors the matrix style of the existing `apps/backend/src/middleware/authorization.test.ts`.
- Update: `apps/backend/src/middleware/authorization.test.ts` — verifies both flag values still produce the same 403/200 results for the historical test cases.
- `apps/backend/src/features/workspace-authz/repository.test.ts` — `hasPermission` happy path, missing row returns false.
- Bootstrap snapshot test: `viewerPermissions` populated for admin and owner; empty for stripped-permission users.
- Frontend: extend tests for `users-tab.tsx`, `members-tab.tsx`, `integrations-tab.tsx` — assert button visibility flips on `viewerPermissions`, not `role` (INV-39 — observable behavior).

**Verification.**
1. Flag off: every existing test passes unchanged. No behavior change.
2. Flag on (in-CI test stage): every migrated route still returns 200 for admin, 403 for user. New permission middleware tests pass.
3. **Staging with flag on:** every UI surface that admins use today still works. Demote a user from admin to member in WorkOS dashboard → fan-out lands in regional → next request returns 403.
4. **`viewerPermissions` correctness:** bootstrap response contains the expected slugs for each role; frontend integrations tab hides "Connect" button for member users.

**Does NOT.** Remove `requireRole` (Phase 3). Touch socket authz (PR-6). Change WorkOS write paths.

**Rollback plan.** Set `WORKSPACE_AUTHZ_USE_PERMISSIONS=false` and redeploy. `requireRole` reverts to the old hierarchy, `viewerPermissions` keeps being populated but is unused server-side. Frontend already prefers permissions — `hasPermission` returns true for admin/owner because the catalog's role definitions still include admin → `workspace:invitations:manage`, so frontend keeps working under flag-off too.

---

### PR-4 — Write paths: assign role, change role, remove member

**Goal.** Operators (via backoffice) and workspace admins (via the future role picker) can write to WorkOS through CP. Regional sees the change through the existing fan-out path within ~5s.

**Depends on.** PR-2 (fan-out wired). PR-3 (regional permission middleware so the new write endpoints can be authz'd by `workspace:members:assign-role`).

**Migration.** None — write paths use existing tables.

**New / modified files.**

`WorkosOrgService` extension:
- Modify: `packages/backend-common/src/auth/workos-org-service.ts` — add three methods to the interface and impl:
  ```ts
  changeOrganizationMembershipRole(membershipId: string, roleSlug: string): Promise<void>
  removeOrganizationMembership(membershipId: string): Promise<void>
  // assignRole reuses ensureOrganizationMembership but is a clearer name for new callers
  ```
  `removeOrganizationMembership` calls `this.workos.userManagement.deleteOrganizationMembership(membershipId)` (confirmed available in the WorkOS SDK at `lib/user-management/user-management.d.ts:103`).
- Modify: `packages/backend-common/src/auth/workos-org-service.stub.ts` — port stubs that mutate `membershipsByOrg` and emit a corresponding mirror event so end-to-end tests can verify the round-trip.

CP service:
- New: `apps/control-plane/src/features/workos-authz/admin-service.ts` (separate file from `service.ts` because it's the *write* path):
  ```ts
  class WorkosAuthzAdminService {
    async assignRole(params: { workspaceId, workosUserId, roleSlug, actor }): Promise<void>
    async changeRole(params: { workspaceId, workosUserId, roleSlug, actor }): Promise<void>
    async removeMember(params: { workspaceId, workosUserId, actor }): Promise<void>
  }
  ```
  Each method:
  1. Validates `roleSlug` against `WORKSPACE_ROLE_SLUGS`.
  2. Resolves `workos_organization_id` and `organization_membership_id` from the existing mirror (`WorkosAuthzRepository.getByOrgAndUser`).
  3. Calls the appropriate WorkOS write method.
  4. Optimistically updates the mirror row (advances `last_event_at` to now, but leaves `last_event_id` alone — when the event poller catches up, the timestamp guard keeps the optimistic update if it's still newer, or the event wins if WorkOS reordered).
  5. Emits an `authz_membership_changed` outbox event so regional gets the update without waiting for the WorkOS event poller.
  6. Logs an audit line with `actor.workosUserId`, `actor.kind: "platform_admin" | "workspace_admin"`, `params`.

Backoffice surface:
- Modify: `apps/control-plane/src/features/backoffice/handlers.ts` — three new handlers under `requirePlatformAdmin`:
  - `POST /api/backoffice/workspaces/:id/members/:workosUserId/role` body `{ roleSlug }` — calls `adminService.changeRole`.
  - `DELETE /api/backoffice/workspaces/:id/members/:workosUserId` — calls `adminService.removeMember`.
  - `POST /api/backoffice/workspaces/:id/members` body `{ workosUserId, roleSlug }` — calls `adminService.assignRole`.
- Modify: `apps/control-plane/src/features/backoffice/service.ts` — these are thin wrappers; new methods route to `WorkosAuthzAdminService`.

Workspace-admin surface (regional → CP via internal API):
- New: `apps/control-plane/src/features/workos-authz/handlers.ts` — three new internal handlers (auth via `INTERNAL_API_KEY_HEADER`) at:
  - `POST /internal/workspaces/:id/members/:workosUserId/role`
  - `DELETE /internal/workspaces/:id/members/:workosUserId`
  - `POST /internal/workspaces/:id/members`
- Modify: `apps/control-plane/src/routes.ts` — register them.
- Modify: `apps/backend/src/lib/control-plane-client.ts` — three new methods that mirror the same shapes and POST to those endpoints.
- New: `apps/backend/src/features/workspace-members/` (INV-51) — `service.ts`, `handlers.ts`, `index.ts`. Service calls `ControlPlaneClient`. Handlers gated with `requireWorkspacePermission("workspace:members:assign-role")`.
- Modify: `apps/backend/src/routes.ts` — register `POST /api/workspaces/:workspaceId/members/:workosUserId/role`, `DELETE /api/workspaces/:workspaceId/members/:workosUserId`. (No `assignRole` from regional — adding members goes through invitations, not direct assignment. The backoffice surface keeps direct-assign for operator recovery.)

Idempotency and safety:
- The "remove member" path also revokes any pending workspace invitations for that email. Not a hard guarantee — best-effort, logged.
- Self-demotion: `changeRole` rejects when `actor.workosUserId === params.workosUserId` and the new role drops the actor's `workspace:members:assign-role` permission. CP-side check; same logic mirrored in regional handler before forwarding so the user gets a fast 400.
- Last-admin guard: `removeMember` and `changeRole` rejecting an admin role both query the mirror for the count of remaining admins (`role_slugs @> ARRAY['admin']`) and refuse if removal would leave zero admins. (`workspace:members:assign-role` is the binding constraint, not `admin` per se — the guard counts users with that permission.)

**Public API surface.**
- Backoffice: three new endpoints under `/api/backoffice/workspaces/:id/members*`.
- Internal CP: three matching endpoints under `/internal/workspaces/:id/members*`.
- Regional: two endpoints under `/api/workspaces/:workspaceId/members/...` permission-gated.

**Tests.**
- CP: `apps/control-plane/src/features/workos-authz/admin-service.test.ts` — happy paths, `roleSlug` validation, last-admin guard, self-demotion guard, optimistic mirror update, outbox emit on success.
- CP: handlers tests — auth requirements, payload validation.
- Regional: workspace-members service tests — calls `ControlPlaneClient` correctly, surfaces 403/409 from CP.
- E2E with stubs: assign role → mirror updates → fan-out fires → regional row updates → permission-checked endpoint sees new state.

**Verification.**
1. Backoffice change-role on staging: WorkOS dashboard reflects the change immediately; regional shows updated permissions ≤ 10s.
2. Workspace-admin change-role from frontend (using the future picker, but for now via `curl` to the new endpoint with an admin session cookie): same.
3. Last-admin guard returns 409 with `{ code: "LAST_ADMIN" }`.
4. Self-demote guard returns 409 with `{ code: "CANNOT_SELF_DEMOTE" }`.

**Does NOT.** Add the role-picker UI (PR-6). Migrate invitations (PR-5). Touch sockets.

---

### PR-5 — Invitation `role_slug` migration

**Goal.** Invitations carry a WorkOS-shaped role slug end-to-end. On accept, the user lands with the right role without anyone hard-coding `"admin"` or `"member"` along the way.

**Depends on.** PR-1 (catalog defines the slugs). Independent of PR-2/3/4 — can land in parallel after PR-1, but ordering it after PR-3 lets the new invitation-creation flow gate on `workspace:invitations:manage` already.

**Migrations.**

Regional. New `apps/backend/src/db/migrations/<timestamp>_workspace_invitations_role_slug.sql`:
```sql
-- Carry the WorkOS-shaped role slug on invitations so the accept flow can
-- assign the right role to the new user without hard-coding "admin" / "member"
-- along the way. Existing rows keep their legacy `role` column ("admin"|"user")
-- and a translation function maps it onto the new slug at accept time.
--
-- INV-3: validated in app code; no enum.

ALTER TABLE workspace_invitations
    ADD COLUMN role_slug TEXT;

-- Backfill historical pending invitations from the legacy column.
UPDATE workspace_invitations
SET role_slug = CASE role
    WHEN 'admin' THEN 'admin'
    WHEN 'user' THEN 'member'
    ELSE 'member'
END
WHERE role_slug IS NULL;
```
Note: do NOT make `role_slug` NOT NULL. The legacy `role` column stays as the canonical persisted column for the lifetime of Phase 2 (consumers like `apps/backend/src/features/invitations/repository.ts:27` still type it `"admin" | "user"`). Phase 3 will drop `role` and make `role_slug` mandatory. Append-only (INV-17).

CP. New `apps/control-plane/src/db/migrations/007_invitation_shadows_role_slug.sql`:
```sql
ALTER TABLE invitation_shadows
    ADD COLUMN role_slug TEXT;
```

**New / modified files.**

Regional:
- Modify: `apps/backend/src/features/invitations/repository.ts` — extend `Invitation`, `InsertEmailInvitationParams`, `InsertLinkInvitationParams` with `roleSlug: WorkspaceRoleSlug`. Persist on insert. Read on select.
- Modify: `apps/backend/src/features/invitations/service.ts` — accept `roleSlug` from handler. Map WorkOS slug back to legacy `role` at insert time (`admin → admin`, `member → user`) so the existing column stays in sync. Plumb `roleSlug` through the outbox payload (`invitation:sent`, `invitation:link-created`).
- Modify: `apps/backend/src/lib/outbox/repository.ts` — extend `InvitationSentOutboxPayload`, `InvitationLinkCreatedOutboxPayload`, `InvitationLinkClaimedOutboxPayload` with `roleSlug`.
- Modify: `apps/backend/src/features/invitations/handlers.ts` — Zod schema accepts `roleSlug` (preferred) and `role` (legacy alias); maps legacy → slug if needed.
- Modify: `apps/backend/src/features/invitations/shadow-sync-outbox-handler.ts` — pass `roleSlug` through to `controlPlaneClient.createInvitationShadow` and `notifyInvitationLinkClaimed`.
- Modify: `apps/backend/src/features/workspaces/service.ts:191` `createUserInTransaction` — accept `roleSlug` (default derived from legacy `role`). On accept, the role assignment uses `roleSlug` so a new "member" doesn't accidentally get persisted as `role: "user"` if we someday split them.

CP:
- Modify: `apps/control-plane/src/features/invitation-shadows/repository.ts` — store and return `role_slug`.
- Modify: `apps/control-plane/src/features/invitation-shadows/service.ts` — `createShadow` accepts `roleSlug`; `acceptShadow` uses the stored `role_slug` when calling `ensureOrganizationMembership` (line 121, currently hard-coded `"member"`); `acceptLinkClaim` does the same.
- Modify: `apps/control-plane/src/features/invitation-shadows/handlers.ts` — Zod schema includes `roleSlug` optional (default `"member"`).
- Modify: `apps/backend/src/lib/control-plane-client.ts` `createInvitationShadow`, `notifyInvitationLinkClaimed` — add `roleSlug` to params.

Hard-coded `"admin"` / `"member"` callsites in workspace creation:
- Modify: `apps/control-plane/src/features/workspaces/service.ts:160` — already `"admin"` for the workspace creator; keep, but use the catalog constant rather than the bare string.

**Public API surface.**
- Frontend send-invitation request body now optionally accepts `roleSlug: WorkspaceRoleSlug` instead of `role: "admin" | "user"`. Both honored for backwards compat during Phase 2.
- Outbox payloads gain `roleSlug`. Old consumers ignore unknown fields — no breakage.

**Tests.**
- Regional invitations service: roundtrip role_slug through send → accept; legacy `role` request still works; mismatch (`role: "user"` + `roleSlug: "admin"`) is rejected with 400.
- CP shadow service: `acceptShadow` uses the stored `roleSlug` when calling `ensureOrganizationMembership`.
- E2E: invite an admin → accept → mirror reflects `role_slugs: ["admin"]` → regional `workspace_user_permissions.permission_slugs` includes `workspace:invitations:manage`.

**Verification.**
1. Send admin invite, accept it locally → user lands with admin perms.
2. Send link invite as admin role, claim it, accept → same.
3. Historical pending invitations (created before the migration ran) accept correctly using the backfilled `role_slug`.
4. WorkOS dashboard shows the right role assigned on the membership.

**Does NOT.** Drop `role` column (Phase 3). Add a UI for picking role (PR-6). Touch socket authz.

---

### PR-6 — Frontend role picker UI + socket authz hook

**Goal.** Workspace admins can change roles and remove members from the existing users tab. The socket layer gets a permission-aware helper for any future privilege-gated subscription, with one current callsite.

**Depends on.** PR-3 (`viewerPermissions`), PR-4 (write endpoints), PR-5 (role slug on invites — so when the picker creates an invite, it picks a slug).

**Migration.** None.

**New / modified files.**

Frontend:
- Modify: `apps/frontend/src/components/workspace-settings/users-tab.tsx`:
  - For each user row, when `viewerPermissions.includes("workspace:members:assign-role")` and the row is *not* the viewer's own user, add a role select (`Select` from existing UI primitives). Options come from a small client-side mirror of `WORKSPACE_ROLE_DEFINITIONS` re-exported from `@threa/types` (the array is already client-safe).
  - Add a "Remove from workspace" affordance with a confirm dialog. Calls `DELETE /api/workspaces/:workspaceId/members/:workosUserId`.
  - Disable both controls for owner rows (cannot demote/remove owners through this surface — owner removal is operator-only via backoffice).
  - Optimistic update on success; toast on failure.
- New: `apps/frontend/src/api/workspace-members.ts` — TanStack Query mutations for the two endpoints.
- Modify: `apps/frontend/src/components/workspace-settings/users-tab.tsx` — invite form gets a role select with `WORKSPACE_ROLE_DEFINITIONS` options. Submitting sends `roleSlug` (PR-5 already accepts it).
- Modify: same for the link-create form.

Frontend design:
- Use the `frontend-design` skill for the picker visual: subtle inline `Select` with role description as `aria-description`. Don't introduce a new modal — keep mutation inline with the row, matching the existing list editorial. Confirm dialog for remove uses the existing `AlertDialog` primitive.

Socket helper:
- New: `apps/backend/src/socket/permission-check.ts` — `requireRoomPermission(pool, workspaceId, workosUserId, slug): Promise<boolean>` thin wrapper around `WorkspaceUserPermissionsRepository.hasPermission`.
- Modify: `apps/backend/src/socket.ts` — refactor existing room-join checks to call the helper for any future permission-gated room. Phase 2 ships one usage: agent-session rooms gain a permission check `workspace:bots:manage` (since agent sessions show up in moderation contexts) — this is a tighter check than current behavior; called out in PR description as a behavior change to confirm with the user before merge. Alternative: ship the helper without enabling it on any room (zero-behavior-change PR). Default to zero-change; the user decides during PR review.

**Public API surface.** None new on the backend (PR-4 already shipped them). Frontend gains two mutations and two new form fields.

**Tests.**
- Frontend integration: rendering a row with `viewerPermissions` containing `workspace:members:assign-role` shows the picker; without it, just the badge. Mutation success → row updates. Mutation 409 (last-admin) → toast surfaced (INV-39).
- Frontend: invite form submits `roleSlug` correctly.
- `apps/backend/src/socket.ts` test: `requireRoomPermission` returns false when permission missing, true when present.

**Verification.**
1. Log in as admin → users tab → demote another admin to member → page refreshes, badge now reads "user", their next request to an invitations endpoint returns 403.
2. Log in as user (no `workspace:members:assign-role`) → users tab shows badges only, no picker.
3. Removing the last admin returns 409 in the toast.
4. Invite link creation defaults to "member" role; switching to "admin" sends `roleSlug: "admin"`.

**Does NOT.** Drop the legacy `role` column (Phase 3). Add SCIM. Add per-stream permissions.

---

## Reused Existing Code

- **Outbox infrastructure:** every fan-out and write-path event uses the existing `OutboxRepository` + `CursorLock` + `OutboxDispatcher` machinery, just with new event types. Same as how Phase 1 reused `CursorLock` semantics.
- **Regional client / control-plane client patterns:** `RegionalClient` (CP→regional) and `ControlPlaneClient` (regional→CP) are extended, not replaced. Internal-API-key auth header (`INTERNAL_API_KEY_HEADER`) keeps the trust boundary.
- **Internal HTTP routing:** `apps/backend/src/handlers/internal-handlers.ts` and `apps/backend/src/routes.ts:195-197` show the existing pattern for internal routes; PR-2 and PR-4 add new ones in the same shape.
- **`requireRole` behavior cache:** existing `apps/backend/src/middleware/authorization.test.ts` matrix style is reused for `requireWorkspacePermission`.
- **Backoffice scaffolding:** the new write endpoints in PR-4 use the existing `requirePlatformAdmin` + `BackofficeService` pattern from Phase 1's PR C.
- **WorkOS SDK methods:** `updateOrganizationMembership` and `deleteOrganizationMembership` exist on `userManagement` (verified in `node_modules/.bun/@workos-inc+node@7.82.0+.../lib/user-management/user-management.d.ts:99-105`). PR-4 wraps them; nothing exotic.
- **Stub services:** `StubWorkosOrgService` already provides `pushMirrorEvent` and `setOrganizationMemberships` test seams from Phase 1. Extended with mutation seams in PR-4 for end-to-end test coverage.

---

## End-to-End Verification (post-merge of all six PRs)

1. **Catalog (PR-1):** `bun workos:check` reports zero drift after a clean sync; new permissions and roles exist in the WorkOS dashboard.
2. **Fan-out (PR-2):** WorkOS dashboard role change → CP mirror updates → CP outbox event → regional `workspace_user_permissions` updates within ~5–10s.
3. **Enforcement (PR-3):** `WORKSPACE_AUTHZ_USE_PERMISSIONS=true` in staging. Demoting an admin to member in WorkOS produces a 403 on the next invitation-list request from that user. `viewerPermissions` shows up in the bootstrap response and the integrations tab "Connect" button hides for that user on next page load.
4. **Write paths (PR-4):** Admin demotes another admin via the new regional endpoint → WorkOS dashboard shows the change → fan-out closes the loop → regional reflects new permissions for that user. Last-admin guard refuses to demote the only admin.
5. **Invitations (PR-5):** Send an "admin" invite. Accept it. New user has admin permissions immediately, both in `users.role` (legacy column, still kept in sync) and in `workspace_user_permissions.permission_slugs`.
6. **UI (PR-6):** Workspace admin uses the picker on the users tab to change someone else's role. Page updates optimistically; if WorkOS rejects, error is surfaced. Permission-gated UI re-renders correctly when roles change in another tab (assuming the tab refetches bootstrap on focus).

If all six pass, Phase 2 is done. Phase 3 then drops `requireRole`, drops the legacy `users.role` column, drops the legacy `workspace_invitations.role` column, and removes the `WORKSPACE_AUTHZ_USE_PERMISSIONS` flag — none of which is in scope here.

---

## Risks and Open Questions

These need user input or are risky enough to call out for the implementing PR's reviewers.

**Product decisions needed before PR-1:**

1. **What roles ship?** Phase 1's `REQUIRED_ROLES` has `admin` and `member`. Regional today has `owner`, `admin`, `user`. The plan above assumes Phase 2 standardizes on `owner`, `admin`, `member` (WorkOS-shaped). Does the user want `owner` as a distinct WorkOS role (more bookkeeping; clearer semantics) or just `admin`+`member` with workspace-creator marked specially in app code (current state)? **Default in this plan: ship `owner` as a separate WorkOS role.** Either way, `scripts/sync-workos-permissions.ts` `REQUIRED_ROLES` needs to grow `owner`.

2. **What permissions ship?** The plan above proposes six: `workspace:invitations:manage`, `workspace:bots:manage`, `workspace:integrations:manage`, `workspace:budget:manage`, `workspace:members:manage`, `workspace:members:assign-role`. This is the minimum set to migrate every existing `requireRole("admin")` callsite. The user should confirm this is the right granularity — splitting `workspace:bots:manage` into `bots:create`, `bots:archive`, `bots:keys:manage` is a defensible alternative. Splitting too finely now creates noise; too coarse now creates churn later.

3. **WorkOS role slug naming:** WorkOS docs use `member` (lowercase, US spelling). Threa's `WorkspaceUserRole` uses `user`. Phase 2 introduces `WORKSPACE_ROLE_SLUGS` ≠ `WORKSPACE_USER_ROLES`. They co-exist for the lifetime of Phase 2. Confirm naming.

4. **Should the workspace-admin remove-member surface exist at all?** The plan above includes it (PR-4, PR-6). Alternative: only operators can remove members; admins can only invite/change-role. This is a product call.

**Technical risks:**

5. **`apps/backend/src/features/system-messages/service.ts:80` reads `u.role === "owner"`** to find owners for system-message notification targeting. This is *not* an authorization check — it's a notification-routing query. The plan leaves it alone with a comment. If we ever drop the `role` column (Phase 3), this query needs to become `permission_slugs @> ARRAY['workspace:owner-notifications']` or similar. Flag for Phase 3.

6. **`apps/backend/src/features/public-api/handlers.ts:146` returns `role: user.role` in the public API response.** External API consumers may be reading it. Phase 2 keeps it; Phase 3's removal of the column needs a deprecation cycle.

7. **Outbox volume on first backfill after PR-2 lands.** A tenant with N memberships across M workspaces produces N fan-out events. Mention in PR-2 release notes; suggest backfilling in a maintenance window. Mitigation: PR-2 batches regional calls per region (one HTTP request with multiple memberships) — implement if measured volume during staging is high enough to matter. **Plan default: per-event request, batch later if needed.**

8. **Self-demotion from owner.** If owner is a real WorkOS role (decision 1), the only-admin guard in PR-4 becomes an only-owner guard. The current "ensure org membership upgrade only ever upgrades to admin, never demotes" behavior in `packages/backend-common/src/auth/workos-org-service.ts:307-332` interacts with this — the comment there assumes admin is the ceiling. Owner support means revisiting that helper.

9. **The flag-flip in PR-3 is per-region-instance, not per-workspace.** If staging and prod are on different regions of the same CP, you can flip them independently. If a single region has multiple instances (multi-AZ), they all share the flag via env. That's the intended granularity.

10. **`status: "pending" | "inactive" | "active"` is mirrored verbatim from WorkOS.** Today nobody distinguishes them at the regional permission-check layer — the `requireWorkspacePermission` helper in PR-3 does NOT consult `status` and treats any row as authoritative. If WorkOS marks a membership `inactive`, the permission still applies until the next event. Decide: should `inactive` membership force-deny? Plan default: yes — `requireWorkspacePermission` adds a `status === "active"` guard, mention in PR-3.

11. **No migration of existing `users.role` column to derived state.** It's kept as a denormalized cache, written by the existing user-creation paths, read by the legacy `requireRole` path during the flag-off window and by the system-message owner query indefinitely. Phase 3 removes it.

---

## Critical Files for Implementation

These are the most critical files; PR-by-PR mapping above shows the full set.

- `/home/user/threa/packages/types/src/workspace-permissions.ts` (new in PR-1; consumed by every other PR)
- `/home/user/threa/apps/control-plane/src/features/workos-authz/service.ts` (modified in PR-2 to emit fan-out outbox events; modified in PR-4 to optimistically update the mirror)
- `/home/user/threa/apps/backend/src/middleware/authorization.ts` (rewritten in PR-3 to be flag-aware and dual-mode)
- `/home/user/threa/apps/backend/src/features/workspace-authz/repository.ts` (new in PR-2; the indexed lookup that powers every authz check on regional)
- `/home/user/threa/apps/backend/src/features/workspaces/handlers.ts` (modified in PR-3 to add `viewerPermissions`; modified in PR-5 to read `roleSlug`)
- `/home/user/threa/packages/backend-common/src/auth/workos-org-service.ts` (modified in PR-4 to add the WorkOS write methods)
