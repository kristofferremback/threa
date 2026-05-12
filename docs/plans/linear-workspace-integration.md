# Threa ← Linear Workspace Integration — Implementation Plan

## Context

Threa already has private-GitHub URL unfurling: when a user posts a link to a private PR, issue, commit, file, diff, or comment, a workspace-level GitHub App installation lets the backend fetch and render a rich preview. Linear is the next target — same UX, same privacy model, but for `linear.app` URLs covering issues, comments, projects, and documents.

The goal is a workspace-level integration (one OAuth install per Threa workspace, acting as an app — not per user) that resolves private Linear content for rich previews. Design, storage, callback flow, worker dispatch, and settings UI all mirror the existing GitHub plumbing so reviewers can reason about it by analogy.

Out of scope for v1: webhooks (require `admin` OAuth scope which conflicts with `actor=app`), write operations (creating issues/comments from Threa), agent features (`app:mentionable` interactions), per-team access controls, non-customer Linear workspaces.

## Key design decisions

- **Auth: OAuth 2.0 `authorization_code` with `actor=app`.** Rejects personal API keys (per-user), `actor=user` (breaks when admin leaves), `client_credentials` (one token per OAuth client, can't scope per customer workspace). Scopes: `read,app:assignable,app:mentionable` (the `app:*` scopes are requested now so we don't need re-consent later; v1 uses only `read`). Cannot request `admin` → no automatic webhooks in v1 (pull-only with TTL cache, matching how GitHub also does not consume webhooks for previews).
- **Client: `@linear/sdk` wrapped in `LinearClient`.** Because `@linear/sdk` exports a class literally called `LinearClient`, the SDK is imported aliased: `import { LinearClient as LinearSdk } from "@linear/sdk"`. Our wrapper owns token refresh (5-min skew, single 401-retry), rate-limit capture, and friendly error mapping. Name intentionally matches the in-flight GitHub rename (`GitHubPreviewClient` → `GitHubClient`).
- **URL shapes recognized:**
  - `https://linear.app/{workspace}/issue/{TEAM}-{NUM}[/slug][#comment-{id}]`
  - `https://linear.app/{workspace}/project/{slug}-{shortId}`
  - `https://linear.app/{workspace}/document/{slug}-{shortId}`
- **Callback is global, not workspace-scoped.** Matches GitHub: `/api/integrations/linear/callback` on both backend and control-plane; workspace ID is recovered from the signed `state` parameter. Control-plane proxies to the workspace's regional backend.
- **Single wire-format install state, different HMAC domain.** Keep `createGithubInstallState` / `verifyGithubInstallState` untouched (pinned by crypto tests and the `@threa/backend-common` extractor name). Add sibling `createLinearInstallState` / `verifyLinearInstallState` using the same `workspaceId.issuedAtMs.hexSig` wire format but a different domain string (`"linear-install-state:"` vs `"github-install-state:"`) so cross-provider replay is rejected while the control-plane's provider-agnostic extractor keeps working unchanged.
- **No schema migration.** `workspace_integrations.provider` and `link_previews.preview_type` are already TEXT per INV-3; validation lives in code.

## Critical files to modify

Backend:

- `apps/backend/src/features/workspace-integrations/service.ts` — add Linear service methods
- `apps/backend/src/features/workspace-integrations/crypto.ts` — add Linear install-state helpers
- `apps/backend/src/features/workspace-integrations/handlers.ts` — add Linear HTTP handlers + generic `buildProviderCallbackRedirectUrl`
- `apps/backend/src/features/workspace-integrations/index.ts` — export Linear surface
- `apps/backend/src/features/link-previews/url-utils.ts` — add `parseLinearUrl` + comment-fragment preservation in `normalizeUrl`
- `apps/backend/src/features/link-previews/worker.ts` — add Linear dispatch branch at lines 391–404
- `apps/backend/src/routes.ts` — register Linear routes under the Workspace integrations block (lines 345–366)
- `apps/backend/src/lib/env.ts` — add `LinearOAuthConfig` + co-presence validator (mirror of lines 193–204)
- `apps/control-plane/src/routes.ts` — add `/api/integrations/linear/callback` (line 90 block)
- `apps/control-plane/src/features/integrations/handlers.ts` — extract `createIntegrationProxyCallback(purpose)` used by both providers

Backend new files:

- `apps/backend/src/features/workspace-integrations/linear-client.ts`
- `apps/backend/src/features/workspace-integrations/linear-oauth.ts`
- `apps/backend/src/features/link-previews/linear-preview.ts`
- Tests: `linear-oauth.test.ts`, `linear-preview.test.ts`

Shared types:

- `packages/types/src/constants.ts` — extend `WORKSPACE_INTEGRATION_PROVIDERS`, add `LINEAR_PREVIEW_TYPES` (do NOT extend `LINK_PREVIEW_CONTENT_TYPES`)
- `packages/types/src/domain.ts` — add `LinearActor`, `LinearTeam`, `LinearIssueState`, `LinearIssueLabel`, `Linear*PreviewData`, `LinearPreview`, `LinearWorkspaceIntegration`, `LinearRateLimit`; widen `LinkPreview.previewData` / `LinkPreviewSummary.previewData` at lines 661 and 681 from `GitHubPreview | null` → `GitHubPreview | LinearPreview | null`
- `packages/types/src/index.ts` — add Linear exports next to the existing GitHub block at lines 203–220

Frontend:

- `apps/frontend/src/api/integrations.ts` — add `getLinear`, `disconnectLinear`
- `apps/frontend/src/components/workspace-settings/integrations-tab.tsx` — add Linear section below GitHub (second `<section>`, second `useQuery` with key `["workspace-integrations", workspaceId, "linear"]`, second `useMutation`)
- `apps/frontend/src/components/timeline/link-preview-card.tsx` — extend the existing 656-line file with `LinearContent` dispatcher and four internal sub-functions (`LinearIssueContent`, `LinearCommentContent`, `LinearProjectContent`, `LinearDocumentContent`) — mirrors GitHub pattern at lines 259–289 and 327+

## Existing functions and utilities to reuse

- `encryptJson` / `decryptJson` in `workspace-integrations/crypto.ts` — AES-256-GCM with AAD `[workspaceId, "linear"]`, same credential-storage shape
- `WorkspaceIntegrationRepository.upsert` — already keyed on `(workspace_id, provider)` with `ON CONFLICT DO UPDATE`, satisfies INV-20 race-safety for free
- `workspaceIntegrationId()` in `apps/backend/src/lib/id.ts:41` — ULID helper (INV-2)
- `extractWorkspaceIdFromGithubInstallState` in `packages/backend-common/src/github-install-state.ts` — provider-agnostic on the wire format (splits on `.`, returns segment[0]); can be reused unchanged for Linear state since both providers use the same `workspaceId.issuedAtMs.hexSig` layout
- `captureRateLimit` pattern at `workspace-integrations/service.ts:90-106` — port to Linear headers
- Token-refresh retry-once pattern in `GitHubPreviewClient.request` / `requestInternal` — Linear client mirrors the same 5-min skew + single 401-retry flow
- `buildGithubCallbackRedirectUrl` in `handlers.ts` — pinned by 5 tests; refactor by extracting `buildProviderCallbackRedirectUrl(req, workspaceId, provider, origins)` underneath and keeping the GitHub function as a 1-line passthrough
- `parseGitHubUrl` in `link-previews/url-utils.ts` — `parseLinearUrl` follows the exact same discriminated-union return shape
- `normalizeUrl` `githubMatch` branch in `url-utils.ts:154-166` — extend with a sibling `linearMatch` branch that preserves `#comment-{id}` on `kind: "comment"`, otherwise clears hash
- `fetchGenericMetadata` in `worker.ts` — existing null-result fallback when provider fetcher returns null
- `MarkdownContent` component — used by `GitHubCommentContent` at lines 597–603 of `link-preview-card.tsx`; Linear comment/description bodies render through the same component (INV-60 does NOT apply to rich cards; only to inline previews)
- `minutesFromNow` / `hoursFromNow` helpers inlined in `github-preview.ts` — replicate inline in `linear-preview.ts` rather than adding TTL constants to `config.ts` (matches colocation pattern)
- `RequireRole` middleware — admin-only gating for connect/disconnect handlers

## OAuth + client details

Credentials JSONB (encrypted):

```ts
{ accessToken, refreshToken, tokenType: "Bearer", tokenExpiresAt, scope, actor: "app" }
```

Metadata (plaintext):

```ts
{ organizationId, organizationName, organizationUrlKey, authorizedUser,
  rateLimit: { requestsRemaining, requestsResetAt, complexityRemaining, complexityResetAt } }
```

`organizationUrlKey` gates URL matching — `fetchLinearPreview` rejects if `parseLinearUrl(url).workspaceSlug !== metadata.organizationUrlKey`. No GitHub analog needed because the installation token scopes `github.com/{owner}/{repo}` access automatically; Linear has no per-request scoping.

Rate-limit gate: skip preview if `requestsRemaining < 100` or `complexityRemaining < 50000`. Headers: `X-RateLimit-Requests-Remaining/Reset`, `X-RateLimit-Complexity-Remaining/Reset`. RATELIMITED returns HTTP 400 with `extensions.code === "RATELIMITED"` — treat as null + update metadata.

Error handling: 404 → null; 401 → refresh once, retry; second 401 → mark `status='error'`, return null; network/timeout → null + `log.debug`.

## Per-URL-kind GraphQL

Hand-written via SDK's raw GraphQL entry point (avoid auto-generated operations — they over-fetch).

Issue (accepts human identifier `"ENG-123"`):

```graphql
query Issue($id: String!) {
  issue(id: $id) {
    id
    identifier
    title
    url
    priority
    priorityLabel
    estimate
    dueDate
    state {
      name
      type
      color
    }
    assignee {
      id
      name
      displayName
      avatarUrl
    }
    team {
      key
      name
    }
    labels(first: 10) {
      nodes {
        name
        color
      }
    }
    project {
      id
      name
    }
    comments(first: 0) {
      pageInfo {
        hasNextPage
      }
    }
    createdAt
    updatedAt
  }
}
```

Comment (body truncated to 320 chars):

```graphql
query Comment($id: String!) {
  comment(id: $id) {
    id
    body
    createdAt
    user {
      id
      name
      displayName
      avatarUrl
    }
    issue {
      identifier
      title
      team {
        key
        name
      }
      state {
        name
        type
        color
      }
    }
  }
}
```

Project (defensive filter form):

```graphql
query Project($slugId: String!) {
  projects(filter: { slugId: { eq: $slugId } }, first: 1) {
    nodes {
      id
      name
      description
      state
      progress
      targetDate
      startDate
      lead {
        id
        name
        displayName
        avatarUrl
      }
      issues(first: 0) {
        pageInfo {
          hasNextPage
        }
      }
    }
  }
}
```

Document: same defensive filter pattern — exact field availability pinned during implementation.

TTLs inlined in `linear-preview.ts`: issue open 5 min / closed 1 h, comment 15 min, project 15 min, document 1 h.

## Rollout order (commit-sized)

1. Types: `constants.ts`, `domain.ts`, `index.ts` in `packages/types`
2. `linear-oauth.ts`, `linear-client.ts`, `crypto.ts` Linear helpers
3. `service.ts` Linear methods, `handlers.ts` Linear handlers
4. `env.ts` Linear config + co-presence validator, `server.ts` construction
5. Backend routes + control-plane `createIntegrationProxyCallback` extraction + Linear route
6. `parseLinearUrl` + `url-utils.test.ts` cases
7. `linear-preview.ts` + tests, worker dispatch branch
8. Frontend API + settings tab Linear section
9. Preview card Linear subcomponents
10. E2E test

Each step is independently verifiable via `bun run test`.

## Invariant compliance

- **INV-2**: reuse `workspaceIntegrationId()`
- **INV-3**: TEXT columns; code-side validation via `as const` arrays
- **INV-8**: all queries filter `workspace_id`
- **INV-11**: `requireLinearEnabled()` throws `HttpError` 503 when config missing
- **INV-12/13**: pass `LinearOAuthConfig` through service deps; service constructed once in `server.ts:394`
- **INV-17**: no migration
- **INV-20**: `ON CONFLICT (workspace_id, provider)` upsert
- **INV-31/33**: types derive from `as const` constants
- **INV-34**: handlers Zod-parse + delegate
- **INV-41**: GraphQL calls happen in worker, outside transactions
- **INV-51/52**: code colocates under the two feature folders; cross-feature imports via barrels
- **INV-55**: `linearCallbackSchema` mirrors `githubCallbackSchema` at `handlers.ts:5-8`
- **INV-60**: strip only in inline surfaces (sidebar, activity feed, notifications); rich cards render markdown via `MarkdownContent` — same rule GitHub comment cards follow

## Verification

Run during development:

- `bun run test` — unit/integration suites, including new `linear-oauth.test.ts`, `linear-preview.test.ts`, extended `url-utils.test.ts`, `crypto.test.ts` (cross-provider replay rejection), `handlers.test.ts` (buildProviderCallbackRedirectUrl for `provider=linear`)
- `bun run test:e2e` — seeded-integration happy-path Linear URL unfurl with mocked GraphQL

Manual end-to-end:

1. Create an OAuth2 app in Linear admin with redirect URI `https://{threa-host}/api/integrations/linear/callback`, set `LINEAR_OAUTH_CLIENT_ID` / `LINEAR_OAUTH_CLIENT_SECRET`
2. In workspace settings → Integrations, click Connect Linear as an admin; authorize on Linear; assert redirect back and "Connected" badge with organization name
3. Post a Linear issue URL in a stream; assert rich preview renders with title, state pill (dynamic color), team key, assignee, labels
4. Post an `#comment-…` URL; assert comment preview with parent-issue header and markdown body
5. Post a project URL; assert project preview with status and progress
6. Disconnect; assert credentials are cleared and future URLs fall through to generic HTML preview (login wall → no preview)

## Must verify during implementation

- `issue(id: "ENG-123")` accepts the human identifier. Fallback: `issues(filter: { number: { eq: N }, team: { key: { eq: "ENG" } } }, first: 1)`
- `project(id: …)` vs `projects(filter: { slugId: { eq: … } })` — start with filter form
- `document` / `documents` field availability — introspect live API before wiring
- `comment(id: $id).issue` resolves directly
- Rate-limit header exact casing and names against a real response
- OAuth `actor=app` token response — refresh token presence, scope string, `expires_in` unit
- RATELIMITED shape: HTTP 400 GraphQL vs HTTP 429 — handle both
- `@linear/sdk` lowest-level raw-GraphQL entry point to avoid over-fetch
