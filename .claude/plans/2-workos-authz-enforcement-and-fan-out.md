# Phase 2: WorkOS Authz Enforcement, Fan-Out, and Naming Cutover

## Context

Phase 1 (`/home/user/threa/.claude/plans/1-yes-please-backfill-async-sky.md`, PRs #477 / #478 / #479) established a passive WorkOS authorization mirror in the control plane. Nothing on the regional hot path changed: regional backends still gate behavior on the static `user < admin < owner` hierarchy in `apps/backend/src/middleware/authorization.ts`, the bootstrap response carries no permission information, and there are no write paths from us back to WorkOS.

**Phase 2 outcome:** WorkOS becomes the runtime source of truth for workspace authorization. User requests read permissions directly from the WorkOS session JWT (no DB lookup on the hot path). API key requests clamp persisted scopes against the owner's current role using a lightweight regional mirror. The role catalog standardizes on `owner`, `admin`, `member` — three real WorkOS roles, each with its own permission set. The frontend gets `viewerPermissions` and a role-picker UI. Invitations carry a role slug end-to-end. Write paths from CP back to WorkOS allow operators (and workspace admins) to assign, change, and remove roles.

**Explicit non-goals for Phase 2:** no SCIM; no per-stream / per-bot fine-grained permissions beyond what PR #482 introduces for personal bots; no removal of WorkOS event poller (still authoritative for mirror state); no migration to a custom JWT minted by Threa (we read WorkOS-issued tokens). No Phase 1 reversal: the mirror, poller, backfill, and backoffice tab continue to operate exactly as they do.

---

## Architectural Decisions

These mirror the shape of Phase 1's decisions and lock in the contracts each PR depends on. Precedence: correctness > architecture boundaries > task scope > style (per CLAUDE.md).

### 1. Permission catalog adapts PR #388 — single TypeScript source of truth, three real roles

A new `packages/types/src/workspace-permissions.ts` defines the catalog. Slugs are ported from PR #388 (the closed unification attempt) plus one addition (`workspace:owner`) so the WorkOS dashboard, API-key permission scopes, and workspace permissions are one unified set of identifiers:

```ts
export const WORKSPACE_PERMISSION_SCOPES = {
  MESSAGES_SEARCH: "messages:search",
  STREAMS_READ: "streams:read",
  MESSAGES_READ: "messages:read",
  MESSAGES_WRITE: "messages:write",
  USERS_READ: "users:read",
  MEMOS_READ: "memos:read",
  ATTACHMENTS_READ: "attachments:read",
  MEMBERS_WRITE: "members:write",
  WORKSPACE_ADMIN: "workspace:admin",
  WORKSPACE_OWNER: "workspace:owner",  // Phase 2 addition — see decision 7
} as const
```

Three roles ship as real WorkOS roles:
- **`owner`** — all 10 permissions (the full set, including `workspace:owner`).
- **`admin`** — all 9 except `workspace:owner`.
- **`member`** — the 7 read-mostly slugs, no `members:write`, no `workspace:admin`, no `workspace:owner`.

`workspace:owner` is the marker permission for ownership-only operations: promoting/demoting an owner, transferring ownership, deleting the workspace, and (in future) managing billing. Admins can do everything else admins can do today. This rejects PR #388's "owner is implicit from `created_by`" framing because it created friction in the write paths (special-cased guards everywhere instead of a uniform permission check) and made ownership transfer a second-class operation. With owner as a real role, the same `requireWorkspacePermission(...)` mechanism gates every write — no special cases.

The existing `API_KEY_PERMISSIONS` in `packages/types/src/api-keys.ts` is consolidated into this same catalog — every API key permission is also a workspace permission, and the WorkOS sync script manages both as a single set. This was the goal of PR #388 and is the smallest stable shape for the catalog going forward.

### 2. Hard cutover `user` → `member` everywhere

Phase 1 left an awkward mismatch: WorkOS roles are `admin` / `member`, regional persistence is `admin` / `user`. PR #388 papered over it with `legacyRoleToWorkos` / `workosRoleToLegacy` translation helpers. Phase 2 deletes the mismatch: `WORKSPACE_USER_ROLES` becomes `["owner", "admin", "member"] as const`, and every site that reads/writes `"user"` is updated. Owner stays in this enum because frontend `Badge` text and the system-message owner query both read `"owner"` today; that's display state, not authz.

This is a hard cut. There's no public-API consumer of the `role` field outside our own codebase, no translation layer, no deprecation aliases. INV-49 (no deprecated aliases after renames) applies. The migration is a one-shot `UPDATE ... SET role = 'member' WHERE role = 'user'` on `users` and `workspace_invitations`. Type changes ripple through TS at compile time.

### 3. Hot-path authz reads from the WorkOS session JWT — no per-request DB lookup

The WorkOS session cookie is a sealed JWT. After `loadSealedSession({ sessionData, cookiePassword }).authenticate()`, the `AuthenticateWithSessionCookieSuccessResponse` already carries `permissions: string[]` (verified at `node_modules/.bun/@workos-inc+node@7.82.0+.../lib/user-management/interfaces/authenticate-with-session-cookie.interface.d.ts:35`). When an admin's WorkOS role is updated, the **next** session refresh (≤ access-token TTL, currently 5 min) issues a JWT carrying the new permission set. No mirror lookup, no fan-out latency, no cache invalidation problem.

Phase 2's hot-path middleware (`requireWorkspacePermission`) reads `req.workosPermissions: Set<string>` populated by the auth middleware directly from `authRes.permissions`. Zero DB calls on the joy path.

The cost is staleness bounded by the access-token TTL. That's fine: a demoted admin loses access within ~5 minutes regardless. For *immediate* revocation we'd need session invalidation, which is out of scope. The WorkOS event poller still updates the mirror, so non-session paths (API keys, write-path validation) see the change immediately.

### 4. API keys clamp stored scopes against the owner's current permissions via a small regional mirror

Personal API keys are owned by a workspace member and persist a scope set chosen at creation time. If the owner's permissions shrink later (admin → member, or removal entirely), every request authenticated by that key must be clamped to the **intersection** of the persisted scopes and the owner's current permissions.

This path is low-volume and cannot read from a session JWT (there's no session). PR-3 introduces a regional `workspace_user_permissions` table — denormalized `(workspace_id, workos_user_id) → permission_slugs`, populated by CP fan-out. The public-API auth middleware (`apps/backend/src/middleware/public-api-auth.ts`) does one indexed read on this table per request, intersects with the key's stored scopes, and uses the result as the effective permission set.

If the owner's row is missing (removed entirely from the workspace), the key returns 403. This makes the mirror authoritative for API-key authz without putting it on the user-session hot path.

### 5. Fan-out reuses the CP outbox pattern, with new event types

Phase 1 added a poller that writes the CP mirror. Phase 2 adds outbox events emitted from `WorkosAuthzService.processEvent` (and from the write paths in PR-5) that the existing `dispatchEvent` switch in `apps/control-plane/src/server.ts:251-266` routes to a new `RegionalAuthzFanOut`. That service calls a new `RegionalClient.syncMembership(...)` method, which posts to a new regional `POST /internal/authz/memberships` endpoint. Same shape as `OUTBOX_REGIONAL_CREATE` → `regionalClient.createWorkspace`. Two new event types: `authz_membership_changed`, `authz_membership_removed`.

Fan-out only feeds the API-key path's mirror, not user sessions. So fan-out latency only impacts API-key clients seeing post-demotion permission shrinkage; user-session clients see it on next refresh regardless of fan-out.

### 6. Inactive members are denied at the middleware

`status` is mirrored verbatim from WorkOS as `"active" | "inactive" | "pending"`. `requireWorkspacePermission` denies any non-`active` status. For session paths, the auth middleware reads `status` from the JWT (also surfaced in `AuthenticateWithSessionCookieSuccessResponse`) and short-circuits to 401 before reaching permission checks. For API-key paths, the mirror's `status` column drives the same gate.

### 7. Workspace admins manage members; owners manage admins; operators recover everything

Per the user's product call: workspace admins can invite, change role between admin/member, and remove admins/members. They **cannot** promote anyone to owner or demote/remove an existing owner — that requires `workspace:owner`. Owners can do everything admins can plus owner-management. Operators (platform admins via backoffice) can do anything as a recovery path.

Concrete write-path rules, all enforced via `requireWorkspacePermission` rather than special cases:
- `assignRole({ roleSlug: "owner" })` — requires `workspace:owner`.
- `assignRole({ roleSlug: "admin" | "member" })` — requires `members:write`.
- `changeRole({ targetRole: "owner" })` — requires `workspace:owner`.
- `changeRole(target_currently_owner)` — requires `workspace:owner` (demoting an owner is itself an owner-only action).
- `changeRole(other cases)` — requires `members:write`.
- `removeMember(target_currently_owner)` — requires `workspace:owner`.
- `removeMember(other cases)` — requires `members:write`.
- Self-demote guard: refuses if `actor === target` and the new role drops `members:write` (consistent across all roles).
- Last-owner guard: refuses if removal/demotion would leave zero users with `role_slugs @> ARRAY['owner']`. Counts via the mirror.

`workspaces.created_by` stays in the table but is no longer load-bearing for authz. Frontend can still display "Workspace creator" as a separate fact, distinct from the `owner` role.

### 8. Personal bots carry their owner's permissions; workspace bots carry the workspace's

PR #482 (sibling, branch `claude/threa-chat-provider-exploration-Z6oCT`) introduces `bots.type ("shared" | "personal")` and `bots.owner_user_id`. Phase 2 leapfrogs that work by ensuring bot authorization integrates with the new permission model from day one:

- **Shared bots** (workspace-owned): authz uses workspace permissions of the *acting* user (e.g. admin can manage; member cannot).
- **Personal bots**: authz uses the *owner's* permissions; only the owner (or a workspace admin) can manage. Stream-grant for personal bots requires the owner be a member of the target stream — that's PR #482's `authorizeBotManagement` rule, ported verbatim.

PR-6 (frontend role picker) and PR-2 (catalog) coordinate the constants (`BOT_TYPES`, `BOT_TRAITS`) so PR #482 and Phase 2 don't fork the source of truth. If PR #482 lands first, Phase 2 imports its constants; if Phase 2 lands first, the constants are stubbed in PR-1 and PR #482 imports them.

### 9. Migration strategy: hard cutover for naming + types; flag-gated dual-read for `requireRole` retirement

Naming/types/DB cutover (decision 2) is one-shot in PR-1. No dual-read.

Removing `requireRole(...)` is *not* one-shot — there are 25+ callsites across handlers, services, and one socket join hook. PR-3 introduces `requireWorkspacePermission(slug)` and migrates routes one-at-a-time inside that PR. The transitional shim: `requireRole(minimumRole)` is rewritten to derive the required permission slug from `WORKSPACE_ROLE_DEFINITIONS` (e.g. `"admin"` → `workspace:admin`) and call the same lookup. There's no flag — the shim *is* the dual-read. After PR-3, every callsite has been migrated; PR-4 deletes `requireRole`.

This keeps PR-3 focused on enforcement plumbing and saves a flag-flip that nobody wants to manage.

---

## Sequencing: Six Small PRs

Land in order. Each is independently mergeable and reversible. Dependencies between them are stated explicitly.

### PR-1 — Permission catalog + hard cutover `user` → `member`

**Goal.** Centralize the permission slugs and role definitions in `packages/types/`. Rename `WorkspaceUserRole`'s `"user"` to `"member"` everywhere — types, persisted DB columns, frontend strings, public API responses. Nothing reads the new permission slugs at runtime yet.

**Depends on.** Nothing.

**Migration (regional, INV-17 append-only).**

```sql
-- Hard cutover: rename the legacy "user" role to "member" so persistence
-- matches the WorkOS-shaped catalog. INV-3: validated in app code.
UPDATE users SET role = 'member' WHERE role = 'user';
UPDATE workspace_invitations SET role = 'member' WHERE role = 'user';
```

(Migration filename via `/add-migration` skill at PR time.)

No CP migration in this PR — the CP mirror already speaks `member`.

**New files.**
- `packages/types/src/workspace-permissions.ts`. Exports:
  - `WORKSPACE_PERMISSION_SCOPES` — the const map shown in decision 1 (10 slugs).
  - `type WorkspacePermissionSlug` — derived from the values.
  - `WORKSPACE_PERMISSIONS: Permission[]` — `{ slug, name, description }` array (same shape `scripts/sync-workos-permissions.ts` consumes).
  - `WORKSPACE_ROLE_DEFINITIONS: RoleDefinition[]` — three entries (`owner`, `admin`, `member`) with their permission lists per decision 1.

**Modified files.**
- `packages/types/src/index.ts` — barrel export the new module (INV-52).
- `packages/types/src/constants.ts:78` — `WORKSPACE_USER_ROLES = ["owner", "admin", "member"] as const`.
  (The workspace-creator code at `apps/control-plane/src/features/workspaces/service.ts:160` still passes `"admin"` after this PR — the cutover to `"owner"` happens in PR-5 alongside the historical-creator backfill, so the WorkOS dashboard has the new role definition synced before any workspace tries to use it.)
- `packages/types/src/api.ts:467,480` — `role: "admin" | "member"` everywhere.
- `packages/types/src/api-keys.ts` — `API_KEY_PERMISSIONS` becomes a re-export of `WORKSPACE_PERMISSIONS` (one shared catalog, decision 1).
- `apps/backend/src/features/workspaces/user-repository.ts:32,52` — `"owner" | "admin" | "member"`.
- `apps/backend/src/features/invitations/repository.ts:27` — `role: "admin" | "member"`.
- `apps/frontend/src/db/database.ts:32` — Dexie schema role type.
- `apps/frontend/src/components/workspace-settings/invite-dialog.tsx:26,105` — role select option value.
- `apps/frontend/src/components/workspace-settings/create-invite-link-dialog.tsx:49,206,207,226` — same.
- `scripts/sync-workos-permissions.ts` — replace inline `REQUIRED_ROLES` and the implicit single-permission catalog with imports from `@threa/types`. Drift detection now treats workspace permissions and API-key permissions as one unified list.
- Anywhere else `"user"` appears as a role string literal: grep + replace. Expected sites (verified in summary): types/api.ts, user-repository, invite/create-invite-link dialogs, frontend Dexie schema, plus any test fixtures.

**Public API surface.**
- `WorkspaceUserRole = "owner" | "admin" | "member"` (was `"owner" | "admin" | "user"`).
- `WORKSPACE_PERMISSION_SCOPES`, `WorkspacePermissionSlug`, `WORKSPACE_ROLE_DEFINITIONS` exported from `@threa/types`.

**Tests.**
- `packages/types/src/workspace-permissions.test.ts` — every permission referenced in `WORKSPACE_ROLE_DEFINITIONS` exists in `WORKSPACE_PERMISSION_SCOPES`; admin ⊇ member. Catalog is structurally valid.
- Update existing tests asserting `"user"` role strings → `"member"`.

**Verification.**
1. `bun run test` — green; no `"user"` role strings in fixtures.
2. `bun run typecheck` — green; no callsite still types `"user"`.
3. `bun workos:check` against staging — drift detected for any new permissions; resolved by `bun workos:sync`.
4. `bun run dev`, log in as a previously-`"user"`-role member, verify the workspace settings page renders the badge as "Member" and existing functionality is unchanged.
5. Migration smoke: `bun run db:migrate` against a snapshot with seeded `role = 'user'` rows; post-migration count of `role = 'user'` is zero and corresponding `role = 'member'` count matches.

**Does NOT.** Wire any runtime permission check. Add fan-out. Touch invitations role-slug plumbing. Touch socket authz.

**Reviewer note.** This PR will fail `workos:check` in CI on the same PR — that's expected. Merge-to-main runs `bun workos:sync` automatically (`.github/workflows/ci.yml:120-159`).

---

### PR-2 — Surface WorkOS permissions on the request

**Goal.** The auth middleware exposes `req.workosPermissions: Set<string>` and `req.workosStatus: string` populated from the session JWT. The bootstrap response carries `viewerPermissions: WorkspacePermissionSlug[]`. Nothing enforces using these yet — purely observational, like Phase 1's CP mirror was.

**Depends on.** PR-1 (catalog).

**Migration.** None.

**Modified files.**

- `packages/backend-common/src/auth/auth-service.ts` — extend `AuthResult.user` with `permissions: string[]` and `status: string`. `authenticateSession` reads them off `authRes` (already on `AuthenticateWithSessionCookieSuccessResponse`); `authenticateWithCode` reads them off the `authenticateWithCode` response.
- `packages/backend-common/src/auth/types.ts` — extend the request-augmentation types to include the two new fields.
- `apps/backend/src/middleware/auth.ts` — populate `req.workosPermissions` and `req.workosStatus` from the auth result. (For local-dev stub auth, return the full member set so admin features remain testable.)
- `apps/control-plane/src/middleware/auth.ts` — same treatment for the CP side; backoffice handlers already gate on `requirePlatformAdmin`, so this is mostly for parity.
- `apps/backend/src/features/workspaces/handlers.ts` `bootstrap` handler (around line 118) — add `viewerPermissions: Array.from(req.workosPermissions ?? [])`. If empty (e.g. token issued before this rollout), fall back to expanding `req.user.role` via `WORKSPACE_ROLE_DEFINITIONS` so the UI is never empty during the rollout window.
- `packages/types/src/api.ts` `WorkspaceBootstrap` — `viewerPermissions: WorkspacePermissionSlug[]`.
- `apps/frontend/src/api/workspaces.ts` — type the new field.
- `apps/frontend/src/lib/permissions.ts` — new helper `hasPermission(viewerPermissions, slug)` for readable callsites.

**Public API surface.**
- `WorkspaceBootstrap.viewerPermissions: WorkspacePermissionSlug[]` (additive).
- `req.workosPermissions: Set<string> | undefined` (internal).
- `req.workosStatus: "active" | "inactive" | "pending" | undefined` (internal).

**Tests.**
- `apps/backend/src/middleware/auth.test.ts` — JWT carrying `permissions: [...]` populates `req.workosPermissions`; missing field → empty set; `status` propagated.
- Bootstrap snapshot test: `viewerPermissions` populated for admin and member roles; matches `WORKSPACE_ROLE_DEFINITIONS`.
- Stub auth path returns the admin permission set so existing tests keep passing.

**Verification.**
1. Log in locally → DevTools → bootstrap response includes `viewerPermissions` matching the user's role.
2. Manually edit the WorkOS dashboard role → wait for next refresh → `viewerPermissions` reflects the new state.
3. `bun run test --filter auth` — green.

**Does NOT.** Enforce anything. Add the regional mirror (PR-3). Touch invitations.

---

### PR-3 — Regional mirror + API-key clamp + `requireWorkspacePermission`

**Goal.** Stand up the regional `workspace_user_permissions` table fed by CP fan-out. Implement `requireWorkspacePermission` for both session paths (read JWT) and API-key paths (read mirror, intersect). Migrate every existing `requireRole` callsite within this PR.

**Depends on.** PR-2 (`req.workosPermissions` exists).

**Migrations.**

Regional. New file (via `/add-migration` skill):
```sql
-- Regional read-side mirror of WorkOS-derived authz state. Populated by CP
-- fan-out via POST /internal/authz/memberships. Source of truth lives in the
-- control plane's workos_organization_memberships table; this denormalizes
-- role_slugs into permission_slugs for the API-key clamp path.
--
-- Session paths read permissions from the WorkOS JWT and DO NOT consult
-- this table. INV-1: no FKs. INV-3: validated in app code. INV-20: race-safe
-- upsert via last_event_at timestamp guard.

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

**New files.**

CP fan-out:
- `apps/control-plane/src/features/workos-authz/fan-out.ts`. `RegionalAuthzFanOut` class:
  - `expandPermissions(roleSlugs: string[]): string[]` — uses `WORKSPACE_ROLE_DEFINITIONS` from `@threa/types`.
  - `syncMembership(workspaceId, region, payload)` and `removeMembership(workspaceId, region, payload)` — call `RegionalClient`.
  - One outbox handler method per event type, dispatched from `apps/control-plane/src/server.ts:dispatchEvent`.

Regional feature module (INV-51):
- `apps/backend/src/features/workspace-authz/repository.ts` — `WorkspaceUserPermissionsRepository`:
  - `upsert(payload)`: timestamp-guarded `INSERT ... ON CONFLICT DO UPDATE WHERE last_event_at < EXCLUDED.last_event_at` (INV-20).
  - `delete(payload)`: timestamp-guarded.
  - `getByWorkspaceAndUser(workspaceId, workosUserId)`: returns `{ roleSlugs, permissionSlugs, status } | null`.
  - `hasPermission(workspaceId, workosUserId, slug)`: helper that does the intersection.
  - `listByWorkspace(workspaceId)` for backoffice.
- `apps/backend/src/features/workspace-authz/service.ts` — `WorkspaceAuthzService.applyMembershipChange/Removal`. Owns transaction boundary (INV-6).
- `apps/backend/src/features/workspace-authz/handlers.ts` — `POST /internal/authz/memberships` Zod-validated (INV-55), discriminated union on `kind: "upsert" | "remove"`.
- `apps/backend/src/features/workspace-authz/index.ts` — barrel (INV-52).
- `apps/backend/src/middleware/workspace-permission.ts` — `requireWorkspacePermission(slug)`. Logic:
  1. If `req.workosStatus !== "active"` → 401.
  2. If `req.workosPermissions?.has(slug)` → next (session path, JWT-only).
  3. Else if `req.apiKey` (API-key path): intersect `req.apiKey.scopes` with `repo.getByWorkspaceAndUser(...).permissionSlugs`; if `slug` in result → next. If owner row missing → 403.
  4. Otherwise 403.

**Modified files.**

CP side:
- `apps/control-plane/src/features/workos-authz/service.ts` — after every successful upsert/delete, write an outbox event in the same tx as the mirror change. Move the repo call into `withTransaction(this.pool, ...)` (it was row-atomic but the outbox guarantee requires a tx).
- `apps/control-plane/src/features/workos-authz/backfill.ts` — emit one fan-out event per surviving membership and per reconciled-deleted membership.
- `apps/control-plane/src/features/workspaces/repository.ts` — `listWorkspaceIdsByWorkosOrganizationId(orgId): Promise<{ id, region }[]>`. Mirror events are keyed on org id; one fan-out event per workspace.
- `apps/control-plane/src/lib/regional-client.ts` — `syncWorkspaceMembership(region, payload)` and `removeWorkspaceMembership(region, payload)`. Both POST to `/internal/authz/memberships`.
- `apps/control-plane/src/server.ts` — extend `dispatchEvent` switch with two new cases. Construct `RegionalAuthzFanOut` in `startServer`.

Regional side:
- `apps/backend/src/middleware/public-api-auth.ts` — after authenticating the API key, look up the owner via `WorkspaceUserPermissionsRepository.getByWorkspaceAndUser(workspaceId, key.ownerWorkosUserId)`; intersect `key.scopes` with `permissionSlugs`; populate `req.workosPermissions = new Set(intersected)`. If owner row missing or `status !== "active"` → 401.
- `apps/backend/src/middleware/authorization.ts` — `requireRole(minimumRole)` is rewritten to compute the equivalent permission slug from the catalog and delegate to `requireWorkspacePermission` (e.g. `"admin"` → `workspace:admin`, `"owner"` → `workspace:owner`). **No flag.** This is the dual-read shim that lets PR-3's per-route migration land incrementally without flag-flipping.
- `apps/backend/src/routes.ts` — register `app.post("/internal/authz/memberships", internalAuth, authz.handle)` and migrate per-route gates:
  - `routes.ts:299-313` (invitations) → `requireWorkspacePermission("members:write")`.
  - `routes.ts:331` (AI budget) → `requireWorkspacePermission("workspace:admin")`.
  - `routes.ts:387-399` (integrations) → `requireWorkspacePermission("workspace:admin")`.
  - `routes.ts:415-466` (bots) → see PR-6 + PR #482 coordination; for now `requireWorkspacePermission("workspace:admin")` for shared-bot endpoints; personal-bot endpoints stay open and use handler-side `authorizeBotManagement` (PR #482).
- `apps/backend/src/features/workspace-integrations/service.ts:191` — replace inline role check with `permissionsRepo.hasPermission(...)` or the upstream session check.
- `apps/backend/src/features/workspaces/handlers.ts:194-196` (bootstrap inviting flag) — `viewerPermissions.includes("members:write")`.
- `apps/backend/src/features/streams/handlers.ts:772` — same pattern.
- `apps/backend/src/features/commands/invite-command.ts:59` — same.
- `apps/backend/src/features/system-messages/service.ts:80` — leave alone (notification targeting, not authz). Comment says so (INV-25 — explain why).
- `apps/backend/src/features/public-api/handlers.ts:146` — `role: user.role` stays in the response shape; it's display state.
- `apps/backend/src/server.ts` — wire up the new feature.

**Public API surface.**
- `requireWorkspacePermission(slug)` middleware.
- `WorkspaceUserPermissionsRepository.hasPermission(...)` for service-layer checks.
- Outbox payloads (typed in `apps/control-plane/src/features/workos-authz/index.ts`):
  ```ts
  interface AuthzMembershipChangedPayload {
    workosOrganizationId: string
    workosUserId: string
    roleSlugs: string[]
    status: "active" | "inactive" | "pending"
    lastEventAt: string  // ISO
  }
  interface AuthzMembershipRemovedPayload {
    workosOrganizationId: string
    workosUserId: string
    eventCreatedAt: string
  }
  ```
- Internal HTTP shape (`POST /internal/authz/memberships`):
  ```ts
  | { kind: "upsert", workspaceId, workosUserId, roleSlugs, permissionSlugs, status, lastEventAt }
  | { kind: "remove", workspaceId, workosUserId, eventCreatedAt }
  ```

**Tests.**
- CP: `apps/control-plane/src/features/workos-authz/fan-out.test.ts` — `expandPermissions` against the catalog; one outbox event per workspace when an org maps to multiple; dispatcher routes correctly.
- CP: extend `service.test.ts` and `backfill.test.ts` for outbox emission.
- Regional: `apps/backend/src/features/workspace-authz/repository.test.ts` — timestamp guard upsert/delete (INV-20), idempotent replay, stale event ignored.
- Regional: `service.test.ts` and `handlers.test.ts` — Zod schema rejects malformed payloads, internal-auth header required, both `kind` variants reach the right method.
- `apps/backend/src/middleware/workspace-permission.test.ts` — session path with JWT permission grants 200; without the slug returns 403; inactive status returns 401; API-key path intersects key scopes with mirror.
- Update `apps/backend/src/middleware/authorization.test.ts` — verify the shim still produces the same 403/200 results for existing test cases (the migration is behavior-preserving).
- E2E: change a member's role in `StubWorkosOrgService.pushMirrorEvent` → assert regional row appears within ~5s and an API-key request reflects the new effective set.

**Verification.**
1. `bun run test --filter workspace-authz` and `--filter workos-authz` — green.
2. **Local stubs:** start CP+regional+stubs, change a membership in `StubWorkosOrgService.pushMirrorEvent`, observe the regional `workspace_user_permissions` row. API-key request to a `requireWorkspacePermission("members:write")` route reflects the change immediately.
3. **Staging real WorkOS:** demote admin → member in dashboard. Session-cookie request: 403 within ~5 min (next refresh). API-key request: 403 within ~10s (fan-out).
4. **Existing test suite:** every test passes; the per-route migration is behavior-preserving via the `requireRole` shim.
5. **Failure injection:** kill regional during fan-out; CP outbox retries; regional drains on restart.

**Does NOT.** Add WorkOS write paths (PR-4). Add invitations role_slug (PR-5). Add the role-picker UI (PR-6).

**Reviewer note.** Backfill emits a fan-out event for *every* surviving membership. For staging this is fine; for production the operator should run backfill during a maintenance window and watch outbox depth.

---

### PR-4 — Delete `requireRole` shim and the legacy hierarchy

**Goal.** All PR-3 callsites are now using `requireWorkspacePermission`. Delete the shim and the `getRoleLevel`/`MIN_ROLE_LEVEL` plumbing. Type the request augmentation tighter.

**Depends on.** PR-3 (every route migrated).

**Migration.** None.

**Modified files.**
- `apps/backend/src/middleware/authorization.ts` — delete `requireRole`, `getRoleLevel`, role hierarchy table.
- `apps/backend/src/middleware/authorization.test.ts` — remove tests for the deleted functions; keep tests for any helpers that survive.
- Any remaining importers — sweep with grep, expect zero.

**Verification.**
1. `bun run typecheck` — green.
2. `bun run test` — green.
3. `grep -rn 'requireRole(' apps/backend/src` → no matches.

**Does NOT.** Touch CP side, frontend, sockets, invitations.

---

### PR-5 — Write paths: assign role, change role, remove member; invitation role_slug

**Goal.** Operators (via backoffice) and workspace admins (via the future role picker) can write to WorkOS through CP. Invitations carry `role_slug` end-to-end.

**Depends on.** PR-3 (regional permission middleware so the new write endpoints can be authz'd by `members:write`).

**Migrations.**

Regional. New file (via `/add-migration`):
```sql
-- Carry the WorkOS-shaped role slug on invitations.
-- INV-3: validated in app code.
ALTER TABLE workspace_invitations ADD COLUMN role_slug TEXT;
UPDATE workspace_invitations SET role_slug = role WHERE role_slug IS NULL;
ALTER TABLE workspace_invitations ALTER COLUMN role_slug SET NOT NULL;
ALTER TABLE workspace_invitations DROP COLUMN role;
```
(Hard cutover — `role` and `role_slug` are now the same set of values after PR-1, so this is a rename, not a translation.)

CP. New file:
```sql
ALTER TABLE invitation_shadows ADD COLUMN role_slug TEXT;
UPDATE invitation_shadows SET role_slug = 'admin' WHERE role_slug IS NULL;  -- existing rows are admin invites
ALTER TABLE invitation_shadows ALTER COLUMN role_slug SET NOT NULL;
```

**New files.**

CP write service:
- `apps/control-plane/src/features/workos-authz/admin-service.ts`:
  ```ts
  class WorkosAuthzAdminService {
    async assignRole(params: { workspaceId, workosUserId, roleSlug, actor }): Promise<void>
    async changeRole(params: { workspaceId, workosUserId, roleSlug, actor }): Promise<void>
    async removeMember(params: { workspaceId, workosUserId, actor }): Promise<void>
  }
  ```
  Each method:
  1. Validates `roleSlug` against `WORKSPACE_ROLE_DEFINITIONS`.
  2. Owner-action gate: if the operation targets an owner (current or new), requires `actor.permissions.has("workspace:owner")` (decision 7). Backoffice operators bypass this since they enter through `requirePlatformAdmin`.
  3. Last-owner guard: refuses if removal/demotion would leave zero users with `role_slugs @> ARRAY['owner']` in the workspace.
  4. Self-demote guard: refuses if `actor.workosUserId === params.workosUserId` and the new role drops `members:write`.
  5. Resolves `organization_membership_id` from the mirror.
  6. Calls the appropriate WorkOS write method.
  7. Optimistically advances `last_event_at` on the mirror row.
  8. Emits an `authz_membership_changed` outbox event so regional fan-out fires immediately.
  9. Logs an audit line with `actor.workosUserId`, `actor.kind: "platform_admin" | "workspace_admin" | "workspace_owner"`, `params`.

`WorkosOrgService` extension:
- `packages/backend-common/src/auth/workos-org-service.ts` — add to interface and impl:
  ```ts
  changeOrganizationMembershipRole(membershipId: string, roleSlug: string): Promise<void>
  removeOrganizationMembership(membershipId: string): Promise<void>
  ```
- `packages/backend-common/src/auth/workos-org-service.stub.ts` — port stubs that mutate `membershipsByOrg` and emit a corresponding mirror event so end-to-end tests can verify the round-trip.

Backoffice surface:
- `apps/control-plane/src/features/backoffice/handlers.ts` — three new handlers under `requirePlatformAdmin`:
  - `POST /api/backoffice/workspaces/:id/members/:workosUserId/role` body `{ roleSlug }`.
  - `DELETE /api/backoffice/workspaces/:id/members/:workosUserId`.
  - `POST /api/backoffice/workspaces/:id/members` body `{ workosUserId, roleSlug }`.
- `apps/control-plane/src/features/backoffice/service.ts` — thin wrappers calling `WorkosAuthzAdminService`.

Workspace-admin surface (regional → CP):
- `apps/control-plane/src/features/workos-authz/handlers.ts` — internal handlers (auth via `INTERNAL_API_KEY_HEADER`):
  - `POST /internal/workspaces/:id/members/:workosUserId/role`
  - `DELETE /internal/workspaces/:id/members/:workosUserId`
- `apps/control-plane/src/routes.ts` — register them.
- `apps/backend/src/lib/control-plane-client.ts` — two new methods.
- `apps/backend/src/features/workspace-members/` (INV-51) — `service.ts`, `handlers.ts`, `index.ts`. Service calls `ControlPlaneClient`. Handlers gated with `requireWorkspacePermission("members:write")`. The owner-action sub-checks (target is owner, new role is owner) happen CP-side in `WorkosAuthzAdminService` so a `members:write`-only admin gets a clean 403 with `code: "OWNER_ACTION"` if they try to touch ownership.
- `apps/backend/src/routes.ts` — register `POST /api/workspaces/:workspaceId/members/:workosUserId/role` and `DELETE /api/workspaces/:workspaceId/members/:workosUserId`. (Adding members goes through invitations, not direct assignment — backoffice keeps direct-assign for operator recovery only.)

Owner backfill (one-shot):
- `apps/control-plane/scripts/backfill-workspace-owners.ts` — standalone Bun script. For each workspace with `created_by` set, look up the WorkOS membership for that user via `workosOrgService.listOrganizationMemberships(orgId)`, and if their current role is `admin`, call `changeOrganizationMembershipRole(membershipId, "owner")`. Idempotent and re-runnable. Exits with the count of upgraded memberships.
- `apps/control-plane/src/features/workspaces/service.ts:160` — flip the workspace-creator role string from `"admin"` to `"owner"` for new workspaces. Lands in the same PR as the backfill so existing workspaces and new workspaces converge in one cutover.
- `package.json` — add `"workos-authz:backfill-owners": "bun apps/control-plane/scripts/backfill-workspace-owners.ts"`.

Operational note: the backfill must run after `bun workos:sync` has propagated the new role definition to WorkOS. PR-1 already triggered that via merge-to-main CI; PR-5 just needs the deploy of PR-1's catalog to staging before the backfill runs.

Invitations role_slug (regional):
- `apps/backend/src/features/invitations/repository.ts` — extend `Invitation`, `InsertEmailInvitationParams`, `InsertLinkInvitationParams` with `roleSlug: WorkspaceUserRole`. Drop the legacy `role` field (DB column dropped in migration).
- `apps/backend/src/features/invitations/service.ts` — accept `roleSlug` from handler. Plumb through outbox payloads (`invitation:sent`, `invitation:link-created`).
- `apps/backend/src/lib/outbox/repository.ts` — `InvitationSentOutboxPayload`, `InvitationLinkCreatedOutboxPayload`, `InvitationLinkClaimedOutboxPayload` rename `role` → `roleSlug`.
- `apps/backend/src/features/invitations/handlers.ts` — Zod schema accepts `roleSlug: WorkspaceUserRole` (only). `role` field dropped — INV-49.
- `apps/backend/src/features/invitations/shadow-sync-outbox-handler.ts` — pass `roleSlug` through to `controlPlaneClient.createInvitationShadow` and `notifyInvitationLinkClaimed`.
- `apps/backend/src/features/workspaces/service.ts:191` `createUserInTransaction` — use `roleSlug` directly.

Invitations role_slug (CP):
- `apps/control-plane/src/features/invitation-shadows/repository.ts` — store and return `role_slug`.
- `apps/control-plane/src/features/invitation-shadows/service.ts` — `createShadow` accepts `roleSlug`; `acceptShadow` uses the stored `role_slug` when calling `ensureOrganizationMembership` (line 121 currently hard-coded `"member"`); `acceptLinkClaim` does the same.
- `apps/control-plane/src/features/invitation-shadows/handlers.ts` — Zod schema requires `roleSlug`.
- `apps/control-plane/src/features/workspaces/service.ts:160` — replace bare string with `WORKSPACE_ROLE_SLUGS.ADMIN` (or equivalent).
- `apps/backend/src/lib/control-plane-client.ts` `createInvitationShadow`, `notifyInvitationLinkClaimed` — add `roleSlug` to params.

**Public API surface.**
- Backoffice: three new endpoints under `/api/backoffice/workspaces/:id/members*`.
- Internal CP: matching endpoints under `/internal/workspaces/:id/members*`.
- Regional: two endpoints under `/api/workspaces/:workspaceId/members/...` permission-gated.
- Invitation creation now requires `roleSlug` instead of `role`.

**Tests.**
- CP: `apps/control-plane/src/features/workos-authz/admin-service.test.ts` — happy paths; `roleSlug` validation; owner-action gate (admin without `workspace:owner` cannot touch owner targets); last-owner guard refuses to leave a workspace ownerless; self-demote guard; optimistic mirror update; outbox emit on success.
- CP: `apps/control-plane/scripts/backfill-workspace-owners.test.ts` — given mixed creators (some admin, some already owner), upgrades only the admin ones; idempotent on re-run; counts correct.
- CP: handlers tests — auth requirements, payload validation.
- Regional: workspace-members service tests — calls `ControlPlaneClient` correctly; surfaces 403/409.
- Regional invitations service: roundtrip `role_slug` through send → accept; payload validation rejects unknown roles.
- CP shadow service: `acceptShadow` uses the stored `roleSlug`.
- E2E: invite an admin → accept → mirror reflects `role_slugs: ["admin"]` → regional row's `permission_slugs` includes `members:write`.

**Verification.**
1. Backoffice change-role on staging: WorkOS dashboard reflects the change immediately; regional row updates ≤ 10s. Operator can promote any member to owner.
2. Workspace-admin change-role from frontend (using PR-6's picker, or curl to the new endpoint): can swap admin↔member; gets `OWNER_ACTION` 403 trying to promote-to-owner or demote-an-owner.
3. Workspace-owner change-role: full range, including ownership transfer.
4. Last-owner guard returns 409 when a workspace would be left ownerless.
5. Self-demote guard returns 409.
6. Send an admin invite, accept it locally → user lands with admin perms.
7. Send link invite as admin role, claim it, accept → same.
8. Backfill: run `bun workos-authz:backfill-owners` against staging → script reports the count of historical workspace creators upgraded admin → owner. Re-run reports zero.

**Does NOT.** Add the role-picker UI (PR-6). Touch sockets.

---

### PR-6 — Frontend role picker, bot authz integration, socket helper

**Goal.** Workspace admins can change roles and remove members from the existing users tab. Bot authz aligns with PR #482's personal/shared distinction. Socket layer gets a permission helper.

**Depends on.** PR-2 (`viewerPermissions`), PR-5 (write endpoints + invitations role_slug).

**Coordination with PR #482.** PR #482 introduces `bots.type` and handler-side `authorizeBotManagement`. Phase 2 PR-6 ships:
- The role-picker UI.
- A `BOT_TYPES` / `BOT_TRAITS` re-export from `@threa/types` (if PR #482 hasn't landed, PR-6 introduces these constants; if it has, PR-6 imports them).
- Bot management endpoints use `authorizeBotManagement(pool, workspaceId, botId, actor)` from PR #482 *or*, if PR #482 hasn't landed, a stub that delegates to `requireWorkspacePermission("workspace:admin")` for shared bots and a TODO for personal bots that PR #482 will fill in.

**Migration.** None.

**New / modified files.**

Frontend role picker:
- `apps/frontend/src/api/workspace-members.ts` — TanStack Query mutations for `POST .../role` and `DELETE .../members/:id`.
- `apps/frontend/src/components/workspace-settings/users-tab.tsx`:
  - For each row other than the viewer's own, render an inline `Select` for the role + a "Remove from workspace" affordance with `AlertDialog` confirm.
  - Picker option set is filtered by viewer permissions:
    - `viewerPermissions.includes("workspace:owner")`: full set (`owner`, `admin`, `member`); can target any row.
    - `viewerPermissions.includes("members:write")` only: `admin`, `member` only; rows whose current role is `owner` render a read-only badge (no picker, no remove).
    - Otherwise: badge only, no controls.
  - Optimistic update; toast on failure (including `OWNER_ACTION` and `LAST_OWNER` codes from PR-5).
- Invite form + link-create form: role select uses `WORKSPACE_ROLE_DEFINITIONS` filtered by `workspace:owner` (only owners can invite as owner); submits `roleSlug` (PR-5 already accepts it).

Frontend design:
- Use the `frontend-design` skill for the picker visual: subtle inline `Select`. Don't introduce a new modal — keep mutation inline with the row.

Socket helper:
- `apps/backend/src/socket/permission-check.ts` — `requireRoomPermission(pool, workspaceId, workosUserId, slug)` thin wrapper around `WorkspaceUserPermissionsRepository.hasPermission`. Used for any future privilege-gated subscription. Phase 2 ships the helper but does NOT enable it on existing rooms (zero-behavior-change).

**Public API surface.** None new on the backend (PR-5 shipped the endpoints). Frontend gains two mutations and two new form fields.

**Tests.**
- Frontend integration (INV-39): row with `viewerPermissions.includes("members:write")` shows the picker; without it, just the badge. Mutation success → row updates. Mutation 409 (last-creator) → toast surfaced.
- Invite form submits `roleSlug` correctly.
- `apps/backend/src/socket/permission-check.test.ts` — returns false when missing, true when present.

**Verification.**
1. Log in as admin → users tab → demote another admin to member → page refreshes, badge now reads "Member", their next request to a `members:write` endpoint returns 403.
2. Log in as admin → row whose current role is `owner` shows a read-only badge, no picker, no remove.
3. Log in as owner → can promote a member to owner (ownership transfer); confirms via the same picker.
4. Log in as member → users tab shows badges only, no picker.
5. Last-owner guard surfaces a `LAST_OWNER` toast when an owner tries to demote themselves and no other owner exists.
6. Invite link creation: members tab admins see `admin`/`member` options; owners also see `owner`.
7. PR #482 personal-bot creation: any member can create; only the bot's owner (or a workspace admin/owner) can manage.

**Does NOT.** Add SCIM. Add per-stream permissions.

---

## Reused Existing Code

- **WorkOS session JWT permission claim:** `AuthenticateWithSessionCookieSuccessResponse.permissions` already exists in the WorkOS SDK; PR-2 just surfaces it (decision 3).
- **Outbox infrastructure:** every fan-out and write-path event uses the existing `OutboxRepository` + `CursorLock` + `OutboxDispatcher`. Same pattern as Phase 1.
- **Regional client / control-plane client patterns:** `RegionalClient` (CP→regional) and `ControlPlaneClient` (regional→CP) extended, not replaced. Internal-API-key auth header keeps the trust boundary.
- **Internal HTTP routing:** `apps/backend/src/handlers/internal-handlers.ts` and `apps/backend/src/routes.ts:195-197` show the existing pattern.
- **Backoffice scaffolding:** PR-5's write endpoints reuse `requirePlatformAdmin` + `BackofficeService` from Phase 1's PR C.
- **WorkOS SDK methods:** `updateOrganizationMembership` and `deleteOrganizationMembership` exist on `userManagement` — verified at `node_modules/.bun/@workos-inc+node@7.82.0+.../lib/user-management/user-management.d.ts:99-105`.
- **Stub services:** `StubWorkosOrgService` already provides `pushMirrorEvent` and `setOrganizationMemberships` test seams from Phase 1; extended with mutation seams in PR-5.
- **PR #388 scope set:** the 9-permission catalog is ported wholesale (decision 1).
- **PR #482 bot constants:** `BOT_TYPES`, `BOT_TRAITS`, `authorizeBotManagement` — coordinated in PR-6.

---

## End-to-End Verification (post-merge of all six PRs)

1. **Catalog and naming (PR-1):** Every codebase reference to `"user"` as a role string is gone. `bun workos:check` reports zero drift after a clean sync. Existing members render their badge as "Member".
2. **Hot-path permissions (PR-2):** Bootstrap response carries `viewerPermissions`. Auth middleware exposes `req.workosPermissions`.
3. **Enforcement (PR-3):** WorkOS dashboard role change → user-session permissions update on next refresh (~5 min); API-key permissions update via fan-out in ~10s. Inactive members get 401. Per-route gates work.
4. **Cleanup (PR-4):** No `requireRole` callers remain. The hierarchy table is gone.
5. **Write paths (PR-5):** Admin demotes another admin via the new regional endpoint → WorkOS dashboard shows the change → fan-out closes the loop. Last-owner guard refuses to leave a workspace ownerless. Owner-action gate refuses an admin's attempt to touch ownership. Owner backfill upgrades historical creators admin → owner. Invitations carry `role_slug` end-to-end.
6. **UI + bot integration (PR-6):** Workspace admin uses the picker on the users tab to change someone else's role. Personal bots created by members (via PR #482) authorize off owner permissions.

If all six pass, Phase 2 is done. Phase 3 (out of scope) would tackle SCIM, per-stream permissions, and any remaining display-state cleanup around the `owner` computation.

---

## Risks and Open Questions

**Confirmed product calls (resolved during planning):**

1. **Roles:** Three real WorkOS roles — `owner`, `admin`, `member`. Owner is its own role with a `workspace:owner` permission (decisions 1 and 7). ✅
2. **Permission slugs:** PR #388's 9-slug catalog plus `workspace:owner` (decision 1). ✅
3. **Naming:** Hard cutover `user` → `member` (decision 2). No public-API consumers. ✅
4. **Workspace admins can remove admins/members; owners can remove anyone:** Yes (decision 7). ✅
5. **Inactive members denied at the middleware:** Yes (decision 6). ✅

**Open technical risks:**

1. **Token staleness window.** A demoted admin keeps their old permissions until next session refresh (≤ 5 min). For immediate revocation we'd need session invalidation — out of scope. The fan-out path closes the gap for API-key clients in ~10s. Document in PR-3 release notes.

2. **Outbox volume on first backfill after PR-3.** A tenant with N memberships across M workspaces produces N fan-out events. Mitigation: batch regional calls per region (one HTTP request with multiple memberships) if measured staging volume is high enough. Plan default: per-event request, batch later if needed.

3. **PR #482 ordering.** If PR #482 lands after Phase 2 PR-6, the bot endpoints in PR-3 are temporarily over-permissive for personal bots (gated only by `workspace:admin`). Acceptable: personal bots don't exist in production yet. If PR-6 lands before PR #482, the `BOT_TYPES` constants are stubbed and PR #482 imports them.

4. **`apps/backend/src/features/system-messages/service.ts:80` reads `u.role === "owner"`.** Notification targeting. With owner as a real role, this query is now authoritative against the same source as authz, no special handling needed. Survives the cutover unchanged.

5. **`apps/backend/src/features/public-api/handlers.ts:146` returns `role`.** Now returns `"admin" | "member" | "owner"` instead of `"admin" | "user" | "owner"`. No external consumers per the user.

6. **Self-removal.** `removeMember` allows `actor === target` (a user removing themselves). The last-creator guard is the only protection. Acceptable: the user was about to leave anyway.

---

## Critical Files for Implementation

- `/home/user/threa/packages/types/src/workspace-permissions.ts` (new in PR-1; consumed by every other PR)
- `/home/user/threa/packages/types/src/constants.ts` (modified in PR-1: `"user"` → `"member"` in `WORKSPACE_USER_ROLES`)
- `/home/user/threa/packages/backend-common/src/auth/auth-service.ts` (modified in PR-2 to surface `permissions` and `status` from the WorkOS JWT)
- `/home/user/threa/apps/backend/src/middleware/workspace-permission.ts` (new in PR-3; the hot-path gate)
- `/home/user/threa/apps/backend/src/features/workspace-authz/repository.ts` (new in PR-3; the API-key clamp lookup)
- `/home/user/threa/apps/backend/src/middleware/public-api-auth.ts` (modified in PR-3 to intersect key scopes with mirror)
- `/home/user/threa/apps/control-plane/src/features/workos-authz/service.ts` (modified in PR-3 to emit fan-out outbox events; modified in PR-5 to optimistically update the mirror)
- `/home/user/threa/apps/backend/src/middleware/authorization.ts` (rewritten in PR-3 as a shim; deleted in PR-4)
- `/home/user/threa/apps/control-plane/src/features/workos-authz/admin-service.ts` (new in PR-5; the WorkOS write path)
- `/home/user/threa/packages/backend-common/src/auth/workos-org-service.ts` (modified in PR-5 to add the WorkOS write methods)
- `/home/user/threa/apps/frontend/src/components/workspace-settings/users-tab.tsx` (modified in PR-6 with the picker)
