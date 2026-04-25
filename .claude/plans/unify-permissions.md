# Unify Workspace Permissions

## Goal

Move workspace authorization onto a shared scope-based model backed by WorkOS roles and permissions, while keeping Threa-local membership checks for workspace, stream, and bot access. This removes the app-vs-API permission drift, adds in-app role assignment for regular workspaces, and keeps API keys clamped to the same effective permissions users have in WorkOS.

## What Was Built

### Shared Permission Model

Introduced a single workspace permission catalog that covers internal authorization, personal API keys, and bot API keys. The old API-key scope exports remain as compatibility aliases during rollout.

**Files:**
- `packages/types/src/api-keys.ts` — defines shared workspace permission scopes and compatibility aliases
- `packages/types/src/api.ts` — extends public wire types for viewer permissions and role assignment
- `packages/types/src/domain.ts` — adds workspace role references and user role metadata
- `scripts/sync-workos-permissions.ts` — syncs the expanded permission catalog and default system roles to WorkOS

### WorkOS-Backed Authorization Resolution

Added a shared authorization resolver that loads current WorkOS membership roles and permissions per workspace request. Session users now resolve permissions live from WorkOS, personal API keys clamp stored scopes against the owner’s current WorkOS permissions, and bot API keys continue to use stored workspace scopes.

**Files:**
- `apps/backend/src/middleware/workspace-authz-resolver.ts` — resolves effective workspace permissions from WorkOS membership data
- `apps/backend/src/middleware/authorization.ts` — exposes request-scoped permission helpers and compatibility-role mapping
- `apps/backend/src/middleware/workspace.ts` — populates session authz context from WorkOS
- `apps/backend/src/middleware/public-api-auth.ts` — clamps personal API keys and normalizes bot key authz
- `packages/backend-common/src/auth/workos-org-service.ts` — adds WorkOS role and organization-membership operations
- `packages/backend-common/src/auth/workos-org-service.stub.ts` — expands the stub service for tests

### Permission-Gated Backend Routes And Realtime Access

Replaced local role checks with permission checks across workspace, invitation, bot, integration, stream, and message routes. Socket joins and agent-session access now enforce the same permission-first authorization model before applying local stream membership rules.

**Files:**
- `apps/backend/src/routes.ts` — switches HTTP route gating to `requireWorkspacePermission(...)`
- `apps/backend/src/socket-auth.ts` — shared socket authorization helper
- `apps/backend/src/socket.ts` — applies WorkOS-backed authz to workspace, stream, and agent-session joins
- `apps/backend/src/features/agents/session-handlers.ts` — uses stream access checks for session reads
- `apps/backend/src/features/workspace-integrations/service.ts` — uses `workspace:admin` instead of local roles

### In-App Role Assignment

Added backend role-listing and role-update flows for the custom Threa UI. Role assignment is single-role only in-app, while multiple-role memberships remain read-only. The service prevents demoting the last user who can still manage roles.

**Files:**
- `apps/backend/src/features/workspaces/service.ts` — lists assignable roles, decorates users with role data, updates WorkOS membership roles, and blocks last-admin demotions
- `apps/backend/src/features/workspaces/handlers.ts` — adds workspace role endpoints and returns viewer permissions in bootstrap
- `apps/backend/src/features/workspaces/repository.ts` — exposes workspace auth metadata including WorkOS org id and owner id
- `apps/backend/src/features/workspaces/user-repository.ts` — keeps compatibility role dual-writes and carries optional role metadata

### Invitation Role Slugs And Control Plane Sync

Migrated invitations and invitation shadows from legacy `admin|user` role storage to WorkOS `roleSlug` values so invites can land on arbitrary WorkOS roles. Invitation acceptance continues to create local users with compatibility roles while WorkOS remains the source of truth for the actual assigned role.

**Files:**
- `apps/backend/src/features/invitations/handlers.ts` — accepts `roleSlug`
- `apps/backend/src/features/invitations/repository.ts` — stores `role_slug`
- `apps/backend/src/features/invitations/service.ts` — propagates `roleSlug`
- `apps/backend/src/features/invitations/shadow-sync-outbox-handler.ts` — syncs `roleSlug` to control plane
- `apps/backend/src/lib/control-plane-client.ts` — sends `roleSlug`
- `apps/control-plane/src/features/invitation-shadows/repository.ts` — stores shadow `role_slug`
- `apps/control-plane/src/features/invitation-shadows/service.ts` — uses `role_slug` when syncing WorkOS memberships

### Frontend Role Management And Capability Gating

Extended workspace bootstrap with `viewerPermissions`, switched settings/member-management gating to permissions, added an invite role picker fed from backend roles, and added inline role reassignment in the users tab. Owner status is display-only and separate from the assigned WorkOS role.

**Files:**
- `apps/frontend/src/api/workspaces.ts` — adds role list and role update API calls
- `apps/frontend/src/sync/workspace-sync.ts` — persists viewer permissions and preserves enriched user role metadata on live updates
- `apps/frontend/src/db/database.ts` — stores viewer permissions and richer user role fields
- `apps/frontend/src/components/workspace-settings/users-tab.tsx` — role editor and owner badge UI
- `apps/frontend/src/components/workspace-settings/invite-dialog.tsx` — WorkOS role picker and compatibility-role mapping for invites
- `apps/frontend/src/components/workspace-settings/integrations-tab.tsx` — gates admin UI on `workspace:admin`
- `apps/frontend/src/components/stream-settings/members-tab.tsx` — gates member management on `members:write`
- `apps/frontend/src/components/user-profile/user-profile-modal.tsx` — shows owner badge separately from assigned role

## Design Decisions

### WorkOS Owns Permissions, Threa Owns Resource Membership

**Chose:** Use WorkOS as the source of truth for org-wide roles and permissions, but keep workspace membership rows, stream membership rows, and bot channel grants inside Threa.
**Why:** That preserves existing resource access behavior while eliminating permission drift between app users and API users.
**Alternatives considered:** Moving stream- or workspace-resource membership into WorkOS was deferred because it would have forced a much larger data-model migration.

### Personal API Keys Clamp At Request Time

**Chose:** Resolve the API key owner’s current WorkOS permissions on every request and intersect them with the key’s stored scopes.
**Why:** This makes permission revocations effective immediately without rotating keys and keeps personal API keys aligned with live role assignment.
**Alternatives considered:** Persisting effective permissions on the key was rejected because it would drift after role changes.

### In-App Editing Is Assignment-Only

**Chose:** Let Threa list and assign existing WorkOS roles, but keep role definition and permission mapping out of the app.
**Why:** Non-enterprise users need an in-app role assignment workflow, but WorkOS still needs to remain the source of truth for role definitions.
**Alternatives considered:** No in-app role assignment was rejected because it would make the default workflow too dependent on WorkOS surfaces outside the app.

### Keep Compatibility Roles During Rollout

**Chose:** Continue dual-writing the local `users.role` column as `admin` or `user`, but stop using it as the source of authorization.
**Why:** This avoids breaking legacy code paths and existing payload shapes during the migration to permission-first authorization.
**Alternatives considered:** Removing the column immediately would have created too much churn across the codebase.

### Realtime Uses The Same Authorization Resolver

**Chose:** Apply the same WorkOS-backed permission resolver to socket workspace, stream, and agent-session joins.
**Why:** Without this, websocket access could drift from HTTP access and bypass the new permission model.
**Alternatives considered:** Keeping sockets on local membership-only checks was rejected as an authorization gap.

## Design Evolution

- **No in-app role assignment → in-app role assignment:** The initial direction was “WorkOS only, no Threa-side role management.” This changed after clarifying that regular workspaces still need to assign roles without leaving the app. The resulting design keeps role definition in WorkOS but adds assignment UI inside Threa.
- **HTTP-only permission rollout → HTTP plus realtime:** The initial implementation focused on route-level permission checks, then expanded to socket joins and agent-session reads to avoid authz drift between transport layers.
- **Slug-based invite compatibility heuristic → permission-derived compatibility role:** The first UI pass inferred the legacy invite role from the selected role slug. This was corrected so custom admin-capable WorkOS roles map to the compatibility `admin` role based on permissions instead.

## Schema Changes

- `apps/backend/src/db/migrations/20260418132127_workspace_invitation_role_slugs.sql` — adds `workspace_invitations.role_slug` and backfills it from the legacy role field
- `apps/control-plane/src/db/migrations/005_invitation_shadow_role_slug.sql` — adds `invitation_shadows.role_slug` and backfills it

## What's NOT Included

- No Threa UI for defining roles or editing which permissions a role has
- No support for editing multi-role WorkOS memberships in-app; those memberships are read-only
- No removal flow for workspace users in this slice
- No attempt to move stream membership or bot stream grants into WorkOS

## Status

- [x] Shared workspace permission catalog replaces the app/API split
- [x] Session users, personal API keys, and bot API keys resolve permissions through one authz model
- [x] HTTP routes use permission checks instead of local role checks
- [x] Socket workspace, stream, and agent-session joins enforce the new permission model
- [x] In-app role listing and assignment endpoints exist
- [x] Invitations store and propagate WorkOS `roleSlug`
- [x] Frontend users and invite flows use WorkOS roles
- [x] Viewer capability checks use `viewerPermissions`
- [x] Focused backend and frontend tests cover the new role-assignment and permission flows
