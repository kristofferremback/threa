# Phase 2 / PR-5 Split: WorkOS Write Paths + Owner Backfill + Invitation Role Slug

## Context

Phase 1 (mirror) and Phase 2 PRs 1-4 are merged:

- PR-1 (#486): permission catalog expansion + `WORKSPACE_PERMISSION_SCOPES`
- PR-2 (#488): CP backoffice "members" tab against the mirror
- PR-3 (#489): regional permission mirror, CP fan-out, `requireWorkspacePermission` middleware (absorbed PR-4's `requireRole` deletion)

PR-5 in the original Phase 2 plan (`.claude/plans/2-workos-authz-enforcement-and-fan-out.md`) bundled six concerns into a single PR:

1. `WorkosOrgService` SDK extensions for membership writes
2. `WorkosAuthzAdminService` with safety gates (owner-action, last-owner, self-demote)
3. Backoffice handlers calling the admin service
4. Regional `workspace-members` feature + CP internal endpoints
5. Owner backfill script + flip workspace-creator default to `owner`
6. Invitation `role_slug` end-to-end

That's too much for one review. This doc splits it into five sub-PRs (5a-5e) that are independently mergeable and verifiable end-to-end. PR-6 (frontend role picker + bot wiring + socket helper) is unchanged.

## Sub-PR Sequence

### 5a — WorkOS SDK + `WorkosAuthzAdminService` (CP)

**Scope:** Pure addition in the control plane. No callers yet, no behavior change in prod.

**Changes:**

- `packages/backend-common/src/auth/workos-org-service.ts`:
  - Add `changeOrganizationMembershipRole(membershipId, roleSlug)`
  - Add `removeOrganizationMembership(membershipId)`
- `packages/backend-common/src/auth/workos-org-service.stub.ts`: matching stubs that update the in-memory `memberships` map.
- `apps/control-plane/src/features/workos-authz/admin-service.ts` (new): `WorkosAuthzAdminService` with:
  - `assignRole({ actor, organizationId, targetUserId, roleSlug })`
  - `changeRole({ actor, organizationId, targetUserId, roleSlug })`
  - `removeMember({ actor, organizationId, targetUserId })`
  - **Owner-action gate:** only actors with `workspace:owner` may invoke any of these.
  - **Last-owner guard:** refuse `changeRole`/`removeMember` if it would leave the org with zero owners. Query the mirror (`workos_organization_memberships`) for current owners, exclude the target if relevant, assert count ≥ 1.
  - **Self-demote guard:** an owner cannot demote themselves; they must transfer ownership first (separate flow, not in scope here).
- `apps/control-plane/src/features/workos-authz/admin-service.test.ts`: unit tests covering happy paths and every guard rejection.

**Reuse:**

- `WorkosAuthzRepository` for mirror queries (`listByOrganization`).
- Existing `WorkosOrgService` constructor pattern; admin service is a thin orchestrator (INV-6, INV-34).

**Verification:**

- `bun run test --filter workos-authz` — all unit tests pass.
- No new endpoints, no migrations, no runtime wiring. Risk-free merge.

---

### 5b — Backoffice member admin (depends on 5a)

**Scope:** Wire `WorkosAuthzAdminService` to the existing PR-2 backoffice members tab so platform admins can change roles and remove members from the dashboard.

**Backend changes:**

- `apps/control-plane/src/features/backoffice/service.ts`:
  - Add `changeMemberRole({ workspaceId, workosUserId, roleSlug })` (resolves workspace → orgId, delegates to admin service).
  - Add `removeMember({ workspaceId, workosUserId })`.
- `apps/control-plane/src/features/backoffice/handlers.ts`:
  - `PATCH /api/backoffice/workspaces/:id/members/:userId` (zod-validated body, INV-55)
  - `DELETE /api/backoffice/workspaces/:id/members/:userId`
- `apps/control-plane/src/routes.ts`: register under `requirePlatformAdmin`.
- Handler test additions in `handlers.test.ts`.

**Frontend changes (`apps/backoffice/src/`):**

- On the existing workspace-detail members tab:
  - Inline `Select` of `WORKSPACE_PERMISSION_SCOPES` role slugs per row.
  - "Remove" action in a row dropdown menu.
  - Confirmation dialog for both actions; success/error toasts.
- TanStack Query mutations with cache invalidation of the members query key.

**Verification:**

- As platform admin: open workspace detail → members tab → change a member's role → mirror reflects new role within ~5s (via the existing PR-3 fan-out).
- Same flow for remove: member disappears from the list and from the regional mirror.
- Non-admin caller hitting the endpoints directly: 403.
- Guard rails enforced: try to demote the last owner → 4xx with a clear error code.

---

### 5c — Owner backfill + new-workspace creator flip

**Scope:** One-shot data correction + small behavior change. Independent of 5a/5b; can ship in parallel.

**Changes:**

- `apps/control-plane/scripts/backfill-workspace-owners.ts` (new): for each workspace, look up the WorkOS organization's memberships, identify the original creator (heuristic: earliest-joined membership, or the membership recorded in `workspace_shadows`/`invitation_shadows` audit trail), and if their `role_slugs` does not include `owner`, call `WorkosAuthzAdminService.assignRole` (or directly the SDK if we want to bypass the actor gate for a one-shot script — TBD; prefer admin service with a synthetic platform-admin actor).
  - Idempotent: skip if the user already has `owner`.
  - Reports a summary (workspaces scanned, owners assigned, owners already present, errors).
- `apps/control-plane/src/features/workspaces/service.ts`: when creating a workspace, assign `owner` (not `admin`) to the creator. Single-line change in the WorkOS membership-creation call.
- `package.json`: add `"workspace-owners:backfill": "bun apps/control-plane/scripts/backfill-workspace-owners.ts"`.

**Verification:**

- Dry-run mode (`--check`) reports what it would change without writing.
- Run against staging → spot-check a handful of orgs in the WorkOS dashboard.
- Create a new workspace via the normal flow → creator's mirror row has `owner` in `role_slugs` within ~5s.
- Re-run the script → reports 0 changes (idempotency).

---

### 5d — Regional `workspace-members` API + CP internal endpoints (depends on 5a)

**Scope:** Expose membership writes through the regional backend so workspace owners can manage their own members via the public API surface (and the eventual PR-6 frontend).

**Control-plane changes:**

- `apps/control-plane/src/features/workos-authz/internal-handlers.ts` (new, or extend an existing internal handlers module):
  - `POST /internal/workspaces/:workspaceId/members` (assign role to an existing org member)
  - `PATCH /internal/workspaces/:workspaceId/members/:userId` (change role)
  - `DELETE /internal/workspaces/:workspaceId/members/:userId`
  - All gated by the internal-only auth middleware used by other CP→regional internal routes.
  - Bodies validated with Zod, delegate to `WorkosAuthzAdminService`.

**Regional backend changes:**

- `apps/backend/src/features/workspace-members/` (new feature folder, INV-51):
  - `handlers.ts`: `PATCH /api/workspaces/current/members/:userId`, `DELETE /api/workspaces/current/members/:userId`. Gated by `requireWorkspacePermission('workspace:owner')` (from PR-3).
  - `service.ts`: calls `control-plane-client` to hit the new internal endpoints. Bubbles up structured errors.
  - `index.ts`: barrel (INV-52).
  - Tests for happy path + permission rejection.
- `packages/backend-common/src/control-plane-client.ts` (or wherever the client lives): add the three new methods.

**Verification:**

- E2E: as a workspace owner, `PATCH /api/workspaces/current/members/:userId` with a new role → CP receives call → admin service validates and calls WorkOS → poller picks up the event → CP mirror updates → fan-out updates the regional mirror within ~5-10s.
- As a non-owner, same call → 403 from `requireWorkspacePermission`.
- Last-owner / self-demote guards: same as 5a tests, now exercised through the regional surface.

---

### 5e — Invitation `role_slug` end-to-end (independent)

**Scope:** Migrate invitations from the legacy `WorkspaceInvitableRole` enum to the `role_slug` model that matches WorkOS. Independent of 5a-5d; can land in parallel.

**Migration:**

- Backend migration: add `role_slug TEXT` column to `invitations`, backfill from the existing `role` column with a mapping (`user → member`, `admin → admin`, `owner → owner`). Leave both columns populated during the transition.
- CP migration for `invitation_shadows`: same shape — add `role_slug`, backfill, dual-write during transition.

**Code changes:**

- `apps/backend/src/features/invitations/repository.ts`: replace `role: WorkspaceInvitableRole` with `roleSlug: string`. Update the SQL to write both columns during the transition window; reads prefer `role_slug` and fall back to `role` if null.
- `apps/backend/src/features/invitations/service.ts`: API accepts `roleSlug`, validates against `WORKSPACE_PERMISSION_SCOPES` role catalog.
- `apps/backend/src/features/invitations/handlers.ts`: Zod schema accepts `roleSlug`; legacy `role` field accepted with a deprecation log line for one release.
- `apps/backend/src/features/invitations/shadow-sync-outbox-handler.ts`: ship `roleSlug` in the shadow payload.
- `apps/control-plane/src/features/invitation-shadows/`: accept and persist `roleSlug`; pass to WorkOS invitation creation.
- `packages/backend-common/src/control-plane-client.ts`: invitation methods carry `roleSlug`.

**Verification:**

- Existing invites continue to work (read fallback).
- Invite a user with `roleSlug: 'member'` via API → invitation persisted, shadow synced, WorkOS invite created with the right role → upon acceptance, WorkOS membership has `member` → mirror row reflects it.
- Repeat for `admin`. Repeat for `owner` (gated to platform admins only via `requireWorkspacePermission('workspace:owner')`).
- Old clients sending `role: 'user'` still work but log a deprecation warning.

**Follow-up (not in this PR):** once all clients are on `roleSlug`, drop the legacy `role` column in a separate migration PR.

---

## Dependency Graph

```
5a (SDK + admin service)
├── 5b (backoffice UI)
└── 5d (regional API + internal CP endpoints)

5c (owner backfill + creator flip)  — independent
5e (invitation role_slug)            — independent
```

## Recommended merge order

`5a → 5c → 5e → 5b → 5d`

Rationale:

- **5a first** because it unblocks 5b and 5d.
- **5c second** so all in-flight workspaces have correct owners before any admin UI ships. Without this, new owners-only endpoints (5b, 5d) would silently lock out legitimate workspace creators.
- **5e third** because invitations are independent and the migration is the simplest standalone change.
- **5b fourth** to give platform admins the dashboard surface to recover from anything 5c missed.
- **5d last** because it exposes the most public surface and benefits from the others being live.

## What this defers to PR-6

Unchanged from the original Phase 2 plan:

- Frontend role picker in the workspace members page (`users-tab.tsx`).
- Invite-form `roleSlug` field in the regular frontend (the backoffice tab in 5b is separate).
- PR #482 `BOT_TYPES` / `authorizeBotManagement` coordination.
- `requireRoomPermission` socket helper.
