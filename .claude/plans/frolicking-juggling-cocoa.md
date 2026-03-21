# API Key Administration UI + WorkOS Role Sync

## Context

The public API v1 is merged (PR #220) with WorkOS-validated API keys, but there's no UI for admins to create/manage keys. WorkOS provides an embeddable `<ApiKeys />` widget that handles key CRUD. Two gaps need filling:

1. **No key management UI** — admins must use the WorkOS dashboard directly
2. **No WorkOS org memberships** — WorkOS organizations are created lazily (on first invitation), but users never get org memberships, so the widget token generation will fail

The widget requires: a WorkOS org to exist, the user to have an org membership with a role that has `widgets:api-keys:manage` permission, and a widget token generated server-side.

---

## Step 1: Extend `WorkosOrgService` with Membership + Widget Methods

**`packages/backend-common/src/auth/workos-org-service.ts`** — add to interface:

```ts
ensureOrganizationMembership(params: {
  organizationId: string
  userId: string
  roleSlug: string
}): Promise<void>

getWidgetToken(params: {
  organizationId: string
  userId: string
  scopes: string[]
}): Promise<string>
```

**`WorkosOrgServiceImpl`** — implement:

- `ensureOrganizationMembership`: calls `workos.userManagement.createOrganizationMembership()`. Catches "already member" errors gracefully (user might already have a membership from a prior flow). If already a member, optionally update the role via `updateOrganizationMembership` if the current role doesn't match.
- `getWidgetToken`: calls `workos.widgets.getToken({ organizationId, userId, scopes })`.

**`packages/backend-common/src/auth/workos-org-service.stub.ts`** — add stub implementations:

- `ensureOrganizationMembership`: no-op log
- `getWidgetToken`: return a fake token string `"stub_widget_token"`

**`packages/backend-common/src/index.ts`** — no new exports needed (interface changes are transparent).

---

## Step 2: Backend Widget Token Endpoint

**`apps/backend/src/features/workspaces/handlers.ts`** — add `getWidgetToken` handler:

```ts
async getWidgetToken(req: Request, res: Response) {
  const workspaceId = req.workspaceId!
  const workosUserId = req.workosUserId!

  // 1. Ensure WorkOS org exists (lazy 3-tier: cache → WorkOS lookup → create)
  let orgId = await WorkspaceRepository.getWorkosOrganizationId(pool, workspaceId)
  if (!orgId) {
    orgId = await workspaceService.ensureWorkosOrganization(workspaceId)
    if (!orgId) {
      throw new HttpError("Could not provision WorkOS organization", { status: 500, code: "INTERNAL" })
    }
  }

  // 2. Ensure user has org membership with admin role
  const roleSlug = "admin"  // WorkOS role slug with widgets:api-keys:manage permission
  await workosOrgService.ensureOrganizationMembership({
    organizationId: orgId,
    userId: workosUserId,
    roleSlug,
  })

  // 3. Generate widget token
  const token = await workosOrgService.getWidgetToken({
    organizationId: orgId,
    userId: workosUserId,
    scopes: ["widgets:api-keys:manage"],
  })

  res.json({ token })
}
```

The `ensureWorkosOrganization` method needs to be added to `WorkspaceService` (or extracted from the control-plane's `InvitationShadowService.ensureWorkosOrganization()`). The logic is identical — 3-tier lookup (local cache → WorkOS by external ID → create new). The backend already has `WorkspaceRepository.getWorkosOrganizationId()` and `setWorkosOrganizationId()`.

**`apps/backend/src/routes.ts`** — register route:

```ts
app.get(
  "/api/workspaces/:workspaceId/widget-token",
  ...authed,
  requireRole("admin"),
  workspace.getWidgetToken
)
```

**Dependencies**: `workosOrgService` needs to be passed through to `registerRoutes` → handler factory. Currently `workosOrgService` is constructed in `server.ts` but not passed to routes. Add it to the `Dependencies` interface and wire it through.

---

## Step 3: `WorkspaceService.ensureWorkosOrganization`

**`apps/backend/src/features/workspaces/service.ts`** — add method:

```ts
async ensureWorkosOrganization(workspaceId: string): Promise<string | null> {
  // Tier 1: Local cache
  const cached = await WorkspaceRepository.getWorkosOrganizationId(this.pool, workspaceId)
  if (cached) return cached

  // Tier 2: WorkOS by external ID
  const existing = await this.workosOrgService.getOrganizationByExternalId(workspaceId)
  if (existing) {
    await WorkspaceRepository.setWorkosOrganizationId(this.pool, workspaceId, existing.id)
    return existing.id
  }

  // Tier 3: Create new
  const workspace = await WorkspaceRepository.findById(this.pool, workspaceId)
  if (!workspace) return null

  const org = await this.workosOrgService.createOrganization({
    name: workspace.name,
    externalId: workspaceId,
  })
  await WorkspaceRepository.setWorkosOrganizationId(this.pool, workspaceId, org.id)
  return org.id
}
```

This mirrors `InvitationShadowService.ensureWorkosOrganization()` in the control-plane. Both share the same 3-tier pattern. The control-plane already handles the concurrent-creation race via `getOrganizationByExternalId` fallback, so if the backend creates the org first, the control-plane will find it via tier 2.

---

## Step 4: Proactive Role Sync on User Join

Sync WorkOS org memberships proactively when users join workspaces, with the widget token endpoint as lazy fallback for existing users.

### 4a: Control-plane — Sync on invitation acceptance

**`apps/control-plane/src/features/invitation-shadows/service.ts`** — in `acceptShadow()`, after `insertMembership`:

```ts
// Best-effort WorkOS org membership (no DB connection held — INV-41)
const orgId = await this.ensureWorkosOrganization(shadow.workspace_id)
if (orgId) {
  try {
    await this.workosOrgService.ensureOrganizationMembership({
      organizationId: orgId,
      userId: user.id,       // WorkOS user ID
      roleSlug: "member",    // Default role for invited users
    })
  } catch (error) {
    logger.warn({ err: error, workspaceId: shadow.workspace_id }, "Failed to sync WorkOS org membership on accept")
  }
}
```

The role is `"member"` for regular invited users. If we later add admin invitations, the role should match the invited role.

### 4b: Control-plane — Sync on workspace creation

**`apps/control-plane/src/features/workspaces/service.ts`** (or wherever workspace creation happens) — after creating the workspace and the owner user:

```ts
// Create WorkOS org and owner membership eagerly
const orgId = await this.ensureWorkosOrganization(workspaceId)
if (orgId) {
  await this.workosOrgService.ensureOrganizationMembership({
    organizationId: orgId,
    userId: workosUserId,   // Creator's WorkOS user ID
    roleSlug: "admin",      // Owner gets admin role
  })
}
```

This ensures the workspace owner immediately has API key management access.

### 4c: Role mapping

| Threa Role | WorkOS Role Slug | Widget Access |
|-----------|-----------------|---------------|
| `owner`   | `admin`         | Yes           |
| `admin`   | `admin`         | Yes           |
| `user`    | `member`        | No            |

The lazy fallback in the widget token endpoint (Step 2) catches existing users who joined before this sync was added.

---

## Step 5: Frontend — Install WorkOS Widgets

Install dependencies:
```bash
bun add @workos-inc/widgets @radix-ui/themes
```

`@tanstack/react-query` v5 is already installed (^5.90.12).

**CSS imports**: Radix Themes CSS and WorkOS Widgets CSS need to be imported. To avoid global style conflicts with Shadcn UI (which uses individual Radix primitives, not Radix Themes), scope the imports to the widget container only. The `<WorkOsWidgets>` provider scopes its theme internally.

**`apps/frontend/src/components/workspace-settings/api-keys-tab.tsx`** — import CSS only in the widget component:
```tsx
// Only import in the widget component, not globally
import "@radix-ui/themes/styles.css"
import "@workos-inc/widgets/styles.css"
```

---

## Step 5: Frontend — API Keys Tab in Workspace Settings

### 5a: Add `useCurrentWorkspaceUser` hook convenience

**`apps/frontend/src/hooks/use-workspaces.ts`** — add:

```ts
export function useCurrentWorkspaceUser(workspaceId: string): User | null {
  const user = useUser()
  const { data: wsBootstrap } = useWorkspaceBootstrap(workspaceId)
  return useMemo(
    () => wsBootstrap?.users?.find((u) => u.workosUserId === user?.id) ?? null,
    [wsBootstrap?.users, user?.id]
  )
}
```

### 5b: Widget token fetching

**`apps/frontend/src/api/workspaces.ts`** — add:

```ts
async getWidgetToken(workspaceId: string): Promise<string> {
  const result = await api.get<{ token: string }>(`/api/workspaces/${workspaceId}/widget-token`)
  return result.token
}
```

### 5c: API Keys Tab component

**`apps/frontend/src/components/workspace-settings/api-keys-tab.tsx`**:

```tsx
import { useQuery } from "@tanstack/react-query"
import { ApiKeys, WorkOsWidgets } from "@workos-inc/widgets"
import "@radix-ui/themes/styles.css"
import "@workos-inc/widgets/styles.css"

export function ApiKeysTab({ workspaceId }: { workspaceId: string }) {
  const { data: tokenData, isLoading, error } = useQuery({
    queryKey: ["widget-token", workspaceId],
    queryFn: () => workspacesApi.getWidgetToken(workspaceId),
    staleTime: 50 * 60 * 1000, // Token valid for 1 hour, refresh at 50 min
  })

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>
  if (error) return <div className="text-sm text-destructive">Failed to load API key management</div>

  return (
    <WorkOsWidgets theme={{
      appearance: "dark",
      accentColor: "iris",   // Match Threa's accent
      radius: "medium",
    }}>
      <ApiKeys token={tokenData!} />
    </WorkOsWidgets>
  )
}
```

The `theme` prop values need to be tuned to match Threa's actual design system. The widget renders its own UI within a scoped Radix Themes context.

### 5d: Update workspace settings dialog

**`apps/frontend/src/components/workspace-settings/workspace-settings-dialog.tsx`**:

- Make tabs dynamic based on user role
- Add "API Keys" tab, visible only to admin/owner

```tsx
import { useCurrentWorkspaceUser } from "@/hooks/use-workspaces"
import { ApiKeysTab } from "./api-keys-tab"

// Dynamic tabs based on role
const currentUser = useCurrentWorkspaceUser(workspaceId)
const isAdmin = currentUser?.role === "admin" || currentUser?.role === "owner"

const tabs = isAdmin
  ? (["general", "users", "api-keys"] as const)
  : (["general", "users"] as const)

const TAB_LABELS = {
  general: "General",
  users: "Users",
  "api-keys": "API Keys",
}
```

Add `TabsContent` for the new tab:
```tsx
<TabsContent value="api-keys" className="mt-0">
  <ApiKeysTab workspaceId={workspaceId} />
</TabsContent>
```

---

## Step 6: WorkOS Dashboard Configuration (Manual)

Before the widget works, configure in WorkOS dashboard:

1. **Roles**: Ensure an "admin" role exists with the `widgets:api-keys:manage` permission. WorkOS may have a default "Admin" role — verify it has this permission, or add it.

2. **CORS**: In WorkOS Dashboard → Authentication → Allowed origins, add:
   - `http://localhost:5173` (dev)
   - `https://app.threa.io` (production)

3. **API Key Permissions**: Already synced via `scripts/sync-workos-permissions.ts`. The permissions (messages:search, streams:read, etc.) are what scope an API key — separate from the widget role permission.

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/backend-common/src/auth/workos-org-service.ts` | Edit | Add `ensureOrganizationMembership` + `getWidgetToken` to interface and impl |
| `packages/backend-common/src/auth/workos-org-service.stub.ts` | Edit | Add stub implementations |
| `apps/backend/src/features/workspaces/service.ts` | Edit | Add `ensureWorkosOrganization` method |
| `apps/backend/src/features/workspaces/handlers.ts` | Edit | Add `getWidgetToken` handler |
| `apps/backend/src/routes.ts` | Edit | Register widget token route, pass `workosOrgService` |
| `apps/backend/src/server.ts` | Edit | Pass `workosOrgService` to `registerRoutes` |
| `apps/control-plane/src/features/invitation-shadows/service.ts` | Edit | Sync org membership on invitation acceptance |
| `apps/control-plane/src/features/workspaces/service.ts` | Edit | Sync org membership on workspace creation |
| `apps/frontend/package.json` | Edit | Add `@workos-inc/widgets`, `@radix-ui/themes` |
| `apps/frontend/src/api/workspaces.ts` | Edit | Add `getWidgetToken` API call |
| `apps/frontend/src/hooks/use-workspaces.ts` | Edit | Add `useCurrentWorkspaceUser` hook |
| `apps/frontend/src/components/workspace-settings/api-keys-tab.tsx` | New | API keys widget wrapper |
| `apps/frontend/src/components/workspace-settings/workspace-settings-dialog.tsx` | Edit | Add role-gated API Keys tab |

---

## Verification

1. **Typecheck**: `bun run typecheck` — all types consistent
2. **E2E tests**: `bun run test:e2e` — existing tests still pass (no regression)
3. **Manual test**:
   - Log in as workspace owner
   - Open Workspace Settings → "API Keys" tab should be visible
   - Widget loads with token, shows API key management UI
   - Create a key, verify it appears
   - Revoke a key, verify it's removed
   - Log in as regular user → "API Keys" tab should NOT be visible
4. **Widget token endpoint**: `curl` with admin session cookie → returns `{ token: "..." }`
5. **Style check**: Widget should render in dark mode with accent colors matching Threa's palette
