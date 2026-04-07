# GitHub Workspace Integration for Rich Link Previews

## Goal

Add the first workspace-level third-party integration, GitHub, and use it to power authenticated rich link previews through the existing server-side link preview pipeline. The integration is installed once per workspace via a GitHub App installation, and all preview fetching in that workspace reuses the installation token instead of generic OGP scraping when a supported GitHub URL is detected.

## What Was Built

### Workspace integration infrastructure

Added a provider-extensible `workspace_integrations` persistence layer plus a backend feature for GitHub install/connect/disconnect/status flows. Credentials are encrypted at rest, the GitHub App state parameter is HMAC-signed, and installation tokens are refreshed lazily when preview fetching needs them.

**Files:**
- `apps/backend/src/db/migrations/20260407230315_add_workspace_integrations_and_github_preview_fields.sql` — adds `workspace_integrations` and extends `link_previews` with rich-preview caching fields
- `apps/backend/src/features/workspace-integrations/service.ts` — GitHub App install flow, token refresh, rate-limit tracking, and preview client creation
- `apps/backend/src/features/workspace-integrations/repository.ts` — repository access for workspace integration records
- `apps/backend/src/features/workspace-integrations/crypto.ts` — credential encryption plus signed install-state helpers
- `apps/backend/src/features/workspace-integrations/handlers.ts` — admin-only API handlers and the GitHub callback handler
- `apps/backend/src/features/workspace-integrations/index.ts` — feature barrel
- `apps/backend/src/features/workspace-integrations/crypto.test.ts` — tests for encryption and state signing
- `apps/backend/src/lib/env.ts` — GitHub App env config
- `apps/backend/src/lib/env.test.ts` — config validation tests
- `apps/backend/src/lib/id.ts` — backend re-export for `workspaceIntegrationId`
- `packages/backend-common/src/id.ts` — new `wsi_*` ID generator
- `packages/backend-common/src/index.ts` — re-export of the new ID helper

### GitHub-aware link preview fetching

Extended the existing preview worker so GitHub URLs can bypass generic OGP scraping and fetch structured preview data through the GitHub API. Supported rich preview types are pull requests, issues, commits, file snippets, and issue/PR comments. The worker now caches preview payloads with TTLs and briefly caches failures to avoid hammering GitHub or broken pages.

**Files:**
- `apps/backend/src/features/link-previews/github-preview.ts` — GitHub URL fetcher and preview-shape builder
- `apps/backend/src/features/link-previews/github-preview.test.ts` — targeted tests for PR and blob previews
- `apps/backend/src/features/link-previews/url-utils.ts` — GitHub URL parsing and normalization updates
- `apps/backend/src/features/link-previews/url-utils.test.ts` — tests for GitHub URL normalization/parsing
- `apps/backend/src/features/link-previews/repository.ts` — stores `preview_type`, `preview_data`, and `expires_at`
- `apps/backend/src/features/link-previews/service.ts` — publishes structured preview payloads through the existing event/API contract
- `apps/backend/src/features/link-previews/worker.ts` — lazy cache refresh, GitHub-first fetching, and short failure TTLs

### Routing and callback delivery

Added a fixed callback path that can be reached through the workspace router and control-plane, then forwarded to the correct regional backend based on the signed workspace state. This keeps the GitHub App callback stable even though workspaces live in different regions.

**Files:**
- `apps/backend/src/routes.ts` — workspace integration routes and fixed GitHub callback route
- `apps/backend/src/server.ts` — service wiring for integrations and the link preview worker
- `apps/control-plane/src/features/integrations/handlers.ts` — callback proxy to the workspace’s regional backend
- `apps/control-plane/src/features/integrations/index.ts` — feature barrel
- `apps/control-plane/src/routes.ts` — callback route registration
- `apps/control-plane/src/server.ts` — route dependency wiring
- `apps/workspace-router/src/index.ts` — sends integration callbacks to the control-plane
- `apps/workspace-router/src/index.test.ts` — router coverage for callback proxying

### Shared contracts and admin UI

Defined the backend/frontend data contract for GitHub preview payloads and added a minimal workspace settings UI so admins can connect, inspect, and disconnect the workspace GitHub installation. The UI is intentionally thin; it exposes status and cached metadata but does not render the rich preview cards themselves.

**Files:**
- `packages/types/src/constants.ts` — integration/provider and GitHub preview type constants
- `packages/types/src/domain.ts` — workspace integration and GitHub preview interfaces
- `packages/types/src/index.ts` — exports for the new shared types
- `apps/frontend/src/api/integrations.ts` — GitHub integration status/disconnect client
- `apps/frontend/src/api/index.ts` — API barrel export
- `apps/frontend/src/components/workspace-settings/integrations-tab.tsx` — admin-only GitHub integration tab
- `apps/frontend/src/components/workspace-settings/workspace-settings-dialog.tsx` — adds the Integrations tab
- `.env.example` — documents GitHub App env vars
- `apps/backend/package.json` — adds `octokit`
- `bun.lock` — dependency lockfile update

## Design Decisions

### Workspace-scoped integration, not per-user auth

**Chose:** A single GitHub App installation per workspace, with one installation token reused for preview fetching
**Why:** This matches the product scope for shared link previews, avoids per-user OAuth in this phase, and creates a reusable workspace-integration pattern for future providers.

### Extend the existing link preview system instead of creating a second pipeline

**Chose:** Keep GitHub previews inside `link_previews`, `message_link_previews`, and the existing worker/outbox flow
**Why:** Reusing the established preview pipeline avoids duplicate caching, persistence, invalidation, and socket delivery logic. The only extension is richer structured payload storage.

### Lazy token refresh on use

**Chose:** Refresh installation tokens only when preview fetching needs them, with a near-expiry skew window
**Why:** GitHub installation tokens expire hourly, but preview traffic is bursty. Lazy refresh avoids background jobs and keeps token lifecycle tied to actual usage.

### Fixed callback path routed through control-plane

**Chose:** Use `/api/integrations/github/callback` as the public callback and proxy it to the workspace’s region
**Why:** GitHub App callbacks need a stable URL. The control-plane and workspace-router already know how to resolve workspaces to regions, so the callback can stay fixed while the actual installation logic remains regional and workspace-scoped.

### Structured preview payloads, not HTML

**Chose:** Return typed GitHub preview objects through `previewType` and `previewData`
**Why:** The frontend needs to render different cards for PRs, issues, commits, files, and comments. Returning structured data keeps formatting decisions in the frontend and avoids backend HTML rendering.

## Design Evolution

- **Workspace settings endpoint shape:** The UI work started as a simple “connect GitHub” button, then expanded to include status, organization metadata, repository selection, cached repo list, and disconnect state so admins can verify what the installation actually covers.
- **Callback delivery path:** The initial backend-only callback route was not sufficient once the fixed callback URL requirement and multi-region routing were considered. The final design adds control-plane and workspace-router forwarding so GitHub can call one stable path and still reach the correct region.
- **Preview caching model:** The original preview worker only cared about pending versus completed rows. The final design adds expiry timestamps plus overwrite semantics so cached previews can be refreshed in place without creating a separate cache store.

## Schema Changes

- `workspace_integrations`
  - `id`, `workspace_id`, `provider`, `status`, `credentials`, `metadata`, `installed_by`, timestamps
  - unique index on `(workspace_id, provider)`
- `link_previews`
  - added `preview_type`
  - added `preview_data`
  - added `expires_at`

## What's NOT Included

- **Per-user GitHub OAuth** — still out of scope for this phase; previews use the workspace installation only
- **Ariadne/agentic repo access** — no repo search or code tools yet
- **GitHub webhooks or push notifications** — no incoming event processing in this change
- **GitHub Enterprise Server** — GitHub Cloud only
- **Frontend rich preview cards** — the backend contract is defined, but the dedicated PR/issue/commit/file/comment components are separate work
- **Cryptographic binding to the installing GitHub user** — the callback validates signed workspace state plus an authenticated workspace admin session, but it still cannot prove that the GitHub user who completed installation is the same human as the workspace admin who initiated it

## Status

- [x] `workspace_integrations` schema and ID plumbing
- [x] GitHub App env/config validation
- [x] Signed GitHub install-state helpers
- [x] Admin connect/status/disconnect/callback backend routes
- [x] Fixed callback routing through workspace-router and control-plane
- [x] Lazy installation-token refresh and cached rate-limit metadata
- [x] GitHub PR/issue/commit/file/comment preview fetching
- [x] Rich preview caching in the existing link preview pipeline
- [x] Shared API/type contract for GitHub preview payloads
- [x] Minimal workspace settings Integrations tab
- [x] Targeted tests and monorepo typecheck passing
