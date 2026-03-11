# Public API v1 — API Key Auth + Message Search

## Context

Threa needs a public-facing API to support external integrations (source control platforms, AI assistants like OpenClaw, programmatic access). The public API must be separate from the internal API so internal endpoints can evolve freely without breaking external consumers.

WorkOS shipped [API Keys](https://workos.com/changelog/api-keys) (Oct 2025) — organization-scoped keys with permission strings, a validation endpoint (`workos.apiKeys.validateApiKey()`), and a self-service management widget (`<ApiKeys />`). Our SDK (`@workos-inc/node@^7`) already has the `apiKeys.validateApiKey()` method available.

This plan delivers the first public endpoint (message search) behind API key auth, establishing the patterns for all future public API expansion.

## Architecture Decisions

- **Path prefix**: `/api/v1/workspaces/:workspaceId/*` for public API, existing `/api/workspaces/:workspaceId/*` stays internal
- **Auth**: `Authorization: Bearer <api_key>` → WorkOS validates → org match check → permission check
- **Channel access**: Public channels accessible by default, private channels require explicit grants via `api_key_channel_access` table
- **Rate limiting**: Workspace-level (600/min) + per-key (60/min), both applied to `/api/v1/` routes
- **Search**: Full-text + semantic (embedding) search, with `semantic: true` as an opt-in flag

---

## Step 1: Database — `api_key_channel_access` table

Create migration: `apps/backend/migrations/YYYYMMDD_api_key_channel_access.sql`

```sql
CREATE TABLE api_key_channel_access (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  api_key_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, api_key_id, stream_id)
);

CREATE INDEX idx_api_key_channel_access_key
  ON api_key_channel_access (workspace_id, api_key_id);
```

Prefixed ULID: `akca_<ulid>` (INV-2). Workspace-scoped (INV-8). No foreign keys (INV-1). TEXT not enum (INV-3).

**File**: New migration in `apps/backend/migrations/`

---

## Step 2: Define API Key Scopes in `@threa/types`

Add public API permission constants that map to WorkOS permission strings:

```ts
export const API_KEY_SCOPES = {
  MESSAGES_SEARCH: "messages:search",
  // Future: MESSAGES_READ, STREAMS_LIST, STREAMS_READ, etc.
} as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[keyof typeof API_KEY_SCOPES]
```

**File**: `packages/types/src/api-keys.ts` (new), re-export from `packages/types/src/index.ts`

---

## Step 3: API Key Auth Middleware

New middleware that validates API keys via WorkOS and resolves workspace context.

### 3a: API Key Auth Service

Add `ApiKeyService` to `packages/backend-common/src/auth/`:

```ts
interface ValidatedApiKey {
  id: string
  name: string
  organizationId: string      // WorkOS org ID
  permissions: Set<string>    // Fast .has() lookups for scope checks
}

interface ApiKeyService {
  validateApiKey(value: string): Promise<ValidatedApiKey | null>
}
```

Production implementation calls `workos.apiKeys.validateApiKey({ value })`. Stub implementation for tests returns a configurable response from an in-memory map.

**Files**:
- `packages/backend-common/src/auth/api-key-service.ts` (new)
- `packages/backend-common/src/auth/api-key-service.stub.ts` (new)
- `packages/backend-common/src/auth/index.ts` (re-export)

### 3b: Public API Auth Middleware

New middleware factory in `apps/backend/src/middleware/public-api-auth.ts`:

1. Extract `Authorization: Bearer <token>` from request
2. Call `apiKeyService.validateApiKey(token)`
3. If invalid/missing → 401
4. Look up `workos_organization_id` for the workspace in the URL via `WorkspaceRepository.getWorkosOrganizationId(pool, workspaceId)` (already exists)
5. Verify the key's `organizationId` matches → 403 if mismatch
6. Set on request: `req.apiKey = { id, name, permissions }`, `req.workspaceId = workspaceId`

Extend Express Request type:

```ts
declare global {
  namespace Express {
    interface Request {
      apiKey?: { id: string; name: string; permissions: Set<string> }
    }
  }
}
```

### 3c: Permission Check Middleware

`requireApiKeyScope(...scopes: ApiKeyScope[])` — checks `req.apiKey.permissions.has(scope)` for each required scope. Returns 403 if any are missing.

**File**: `apps/backend/src/middleware/public-api-auth.ts` (new)

---

## Step 4: API Key Channel Access — Repository + Service

New feature module: `apps/backend/src/features/api-keys/`

### Repository (`repository.ts`)

- `getAccessibleStreamIds(db, workspaceId, apiKeyId)` → returns stream IDs from `api_key_channel_access` for this key
- `grantAccess(db, { id, workspaceId, apiKeyId, streamId, grantedBy })` → INSERT
- `revokeAccess(db, workspaceId, apiKeyId, streamId)` → DELETE
- `listGrants(db, workspaceId, apiKeyId)` → list all grants for a key

### Service (`service.ts`)

- `getAccessibleStreamIdsForApiKey(workspaceId, apiKeyId)` → combines:
  1. All public streams in workspace (reuse `SearchRepository.getPublicStreams()` which already exists)
  2. Explicitly granted private streams from `api_key_channel_access`
  3. Deduplicates and returns combined set

**Files**:
- `apps/backend/src/features/api-keys/repository.ts` (new)
- `apps/backend/src/features/api-keys/service.ts` (new)
- `apps/backend/src/features/api-keys/index.ts` (new barrel)

---

## Step 5: Public Search Endpoint

### Handler (`apps/backend/src/features/api-keys/handlers.ts`)

Factory: `createPublicApiHandlers({ searchService, apiKeyChannelService })`

`POST /api/v1/workspaces/:workspaceId/messages/search`

Request body (Zod validated):
```ts
{
  query: string              // Required (non-empty)
  semantic?: boolean         // Opt-in embedding search (default: false)
  streams?: string[]         // Filter to specific stream IDs
  from?: string              // Author ID filter
  type?: StreamType[]        // Stream type filter
  before?: ISO datetime      // Exclusive (<)
  after?: ISO datetime       // Inclusive (>=)
  limit?: number             // 1-50 (lower max than internal)
}
```

Handler flow:
1. Resolve accessible stream IDs via `apiKeyChannelService.getAccessibleStreamIdsForApiKey()`
2. Call `searchService.search()` with `permissions: { accessibleStreamIds }` and any user-provided filters
3. Return results

### SearchService refactor — explicit `permissions` parameter

The service currently owns stream access resolution (via `getAccessibleStreamIds()` using a `userId`). This couples search to user-based auth. Instead, the **caller** resolves access and passes it in via a `permissions` object. The service becomes auth-agnostic.

New `SearchParams`:
```ts
export interface SearchPermissions {
  accessibleStreamIds: string[]     // What the caller CAN see (empty → empty results)
  // Extensible: future fields like maxResults, canSearchArchived, etc.
}

export interface SearchParams {
  workspaceId: string
  permissions: SearchPermissions    // Caller-resolved access boundary
  query: string
  filters?: SearchFilters           // streamIds here = user intent ("search in these"), intersected with permissions
  limit?: number
  exact?: boolean
}
```

The service intersects `filters.streamIds` (if provided) with `permissions.accessibleStreamIds`. Empty `permissions.accessibleStreamIds` → return `[]` immediately.

Changes:
- Replace `userId` with `permissions` on `SearchParams`
- Remove `getAccessibleStreamIds()` private method from `SearchService` (move to a standalone helper)
- Service intersects `permissions.accessibleStreamIds` with `filters.streamIds` internally
- Internal search handler resolves access via existing `SearchRepository.getAccessibleStreamsWithMembers()` and passes as `permissions`
- Public search handler resolves access via `ApiKeyChannelService.getAccessibleStreamIdsForApiKey()` and passes as `permissions`
- Agent search tool already receives `accessibleStreamIds` from deps — passes directly as `permissions` (removes redundant `userId`)

Three callers need updating:
1. **Internal search handler** (`features/search/handlers.ts`) — resolve via `SearchRepository.getAccessibleStreamsWithMembers()`, pass as `permissions`
2. **Agent search tool** (`features/agents/tools/search-workspace-tool.ts`) — already has `accessibleStreamIds` from deps, just wraps in `permissions` object (removes redundant double resolution)
3. **Public API handler** (new) — resolves via `ApiKeyChannelService`, passes as `permissions`

The access resolution logic currently in `SearchService.getAccessibleStreamIds()` moves into a helper function that the internal search handler calls. This is a move, not a rewrite — same SQL, same logic, different call site.

**Files**:
- `apps/backend/src/features/api-keys/handlers.ts` (new)
- `apps/backend/src/features/search/service.ts` (edit — remove userId, accept accessibleStreamIds)
- `apps/backend/src/features/search/handlers.ts` (edit — resolve access before calling service)
- `apps/backend/src/features/search/access.ts` (new — extracted access resolution helper)
- `apps/backend/src/features/agents/tools/search-workspace-tool.ts` (edit — pass accessibleStreamIds instead of userId)

---

## Step 6: Rate Limiting for Public API

Add to `apps/backend/src/middleware/rate-limit.ts`:

```ts
// Workspace-level rate limit for all API key requests
publicApiWorkspace: createRateLimit({
  name: "public-api-workspace",
  windowMs: 60_000,
  max: 600,
  key: (req) => req.workspaceId || "unknown",
}),

// Per-key rate limit
publicApiKey: createRateLimit({
  name: "public-api-key",
  windowMs: 60_000,
  max: 60,
  key: (req) => req.apiKey?.id || getClientIp(req, "unknown"),
}),
```

Both applied as middleware on `/api/v1/` routes.

**File**: `apps/backend/src/middleware/rate-limit.ts` (edit)

---

## Step 7: Route Registration

In `apps/backend/src/routes.ts`:

```ts
// Public API v1 routes
const publicAuth = createPublicApiAuthMiddleware({ apiKeyService, pool })

app.post(
  "/api/v1/workspaces/:workspaceId/messages/search",
  rateLimits.publicApiWorkspace,
  rateLimits.publicApiKey,
  publicAuth,
  requireApiKeyScope(API_KEY_SCOPES.MESSAGES_SEARCH),
  publicApi.searchMessages
)
```

**File**: `apps/backend/src/routes.ts` (edit)

---

## Step 8: Workspace Router — Route `/api/v1/` to Backend

Add regex to match `/api/v1/workspaces/:workspaceId/*` and route to the regional backend (same as existing workspace routes):

```ts
const PUBLIC_API_ROUTE_RE = /^\/api\/v1\/workspaces\/([^/]+)(?:\/.+)?$/
```

Add check alongside the existing `WORKSPACE_ROUTE_RE` match.

**File**: `apps/workspace-router/src/index.ts` (edit)

---

## Step 9: Wire Dependencies in Server Bootstrap

In `apps/backend/src/server.ts`:

1. Create `ApiKeyService` (production or stub based on env)
2. Create `ApiKeyChannelService` with pool dependency
3. Create public API handlers via factory
4. Pass to `registerRoutes()`

**File**: `apps/backend/src/server.ts` (edit)

---

## Step 10: OpenAPI Spec Generation

Use `zod-openapi` to derive an OpenAPI 3.1 spec from our Zod request/response schemas. Since all public API endpoints already use Zod validation, we annotate the schemas with `.openapi()` metadata and generate the spec.

**Approach**: Create a registry file that collects all public API schemas and produces a JSON/YAML OpenAPI doc. This can be generated at build time or served at `/api/v1/openapi.json`.

```ts
// apps/backend/src/features/api-keys/openapi.ts
import { createDocument } from "zod-openapi"

// Registers all public API schemas with OpenAPI metadata
// Exports the generated OpenAPI document
```

The Zod schemas for the public search endpoint (Step 5) get `.openapi()` annotations for titles, descriptions, and examples. The generated spec is served as a static endpoint — no runtime cost.

**Files**:
- `apps/backend/src/features/api-keys/openapi.ts` (new)
- `apps/backend/src/routes.ts` (edit — serve `/api/v1/openapi.json`)

**Dependency**: `zod-openapi` (add to `apps/backend/package.json`)

---

## Step 11: Tests

### Unit tests
- API key auth middleware: valid key, invalid key, org mismatch, missing header
- Permission check middleware: has scope, missing scope
- API key channel access repository: grant, revoke, list
- API key channel service: combines public + granted streams

### E2E test
- `apps/backend/tests/e2e/public-api-search.test.ts`:
  - Search with valid API key returns results from public channels
  - Search with valid API key + granted private channel access returns private results
  - Invalid API key returns 401
  - Missing required scope returns 403
  - Key from different workspace returns 403
  - Rate limiting returns 429
  - Semantic search opt-in works

Uses stub `ApiKeyService` (same pattern as existing auth stub).

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/backend/migrations/YYYYMMDD_api_key_channel_access.sql` | New | Channel access grants table |
| `packages/types/src/api-keys.ts` | New | Scope constants and types |
| `packages/types/src/index.ts` | Edit | Re-export api-keys |
| `packages/backend-common/src/auth/api-key-service.ts` | New | WorkOS API key validation service |
| `packages/backend-common/src/auth/api-key-service.stub.ts` | New | Test stub |
| `packages/backend-common/src/auth/index.ts` | Edit | Re-export |
| `apps/backend/src/middleware/public-api-auth.ts` | New | Auth + permission middleware |
| `apps/backend/src/middleware/rate-limit.ts` | Edit | Add public API rate limiters |
| `apps/backend/src/features/api-keys/repository.ts` | New | Channel access data access |
| `apps/backend/src/features/api-keys/service.ts` | New | Channel access business logic |
| `apps/backend/src/features/api-keys/handlers.ts` | New | Public API endpoint handlers |
| `apps/backend/src/features/api-keys/index.ts` | New | Barrel export |
| `apps/backend/src/features/search/service.ts` | Edit | Remove userId, accept accessibleStreamIds |
| `apps/backend/src/features/search/handlers.ts` | Edit | Resolve access before calling service |
| `apps/backend/src/features/search/access.ts` | New | Extracted access resolution helper |
| `apps/backend/src/features/agents/tools/search-workspace-tool.ts` | Edit | Pass accessibleStreamIds instead of userId |
| `apps/backend/src/routes.ts` | Edit | Register `/api/v1/` routes |
| `apps/backend/src/server.ts` | Edit | Wire dependencies |
| `apps/workspace-router/src/index.ts` | Edit | Route `/api/v1/` paths |
| `apps/backend/src/features/api-keys/openapi.ts` | New | OpenAPI spec from Zod schemas |
| `apps/backend/tests/e2e/public-api-search.test.ts` | New | E2E tests |

## Deferred (not in this PR)

- API Keys widget integration in frontend admin settings
- Channel access management UI
- Cost/usage buckets and billing tier rate limits
- Additional public endpoints (streams list, message read, etc.)
- Hosted API documentation UI (Swagger/Redoc) — spec is generated, but no UI yet

## Verification

1. **Type check**: `bun run typecheck` passes
2. **Unit tests**: `bun run test` — new tests pass, existing tests unaffected
3. **E2E tests**: `bun run test:e2e` — new public API search tests pass
4. **Manual test**: `curl -H "Authorization: Bearer <test_key>" POST /api/v1/workspaces/<id>/messages/search` returns search results
5. **Negative cases**: Invalid key → 401, wrong workspace → 403, missing scope → 403, rate limit → 429
