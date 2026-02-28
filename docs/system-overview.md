# System Overview

High-level view of how Threa's services are composed, how they communicate, and what infrastructure each depends on.

## Service Map

```
                           app.threa.io
                                |
                     +----------+----------+
                     |                     |
                 /api/*              everything else
                     |                     |
           +---------v----------+   +------v-------+
           | Workspace Router   |   |   Frontend   |
           | (Cloudflare Worker)|   | (CF Pages)   |
           +---------+----------+   +--------------+
                     |
          +----------+----------+
          |                     |
    /api/auth/*           /api/workspaces/:id/*
    /api/workspaces       (region-scoped)
    /api/regions               |
          |              region lookup
          |              (CF KV cache)
          |                    |
   +------v-------+    +------v-------+
   | Control Plane |    |   Backend    |
   | (Railway)     |    | (Railway)    |
   +------+--------+    +------+-------+
          |                    |
          |  +--------+       |
          +->| Pg (CP)|       +----> PostgreSQL (regional)
          |  +--------+       +----> AWS S3 (regional)
          |                   +----> OpenRouter (AI)
          +----> Cloudflare KV
          +----> WorkOS (auth)

    wss://ws-eu.threa.io --------> Backend (direct WebSocket)
```

### Request Routing

All browser traffic hits `app.threa.io`. Cloudflare Workers Routes claim `/api/*` and forward to the workspace router; everything else falls through to Cloudflare Pages (the frontend SPA).

The workspace router inspects the path to decide the destination:

| Pattern | Destination |
|---|---|
| `/api/auth/*` | Control plane |
| `GET/POST /api/workspaces` | Control plane |
| `/api/regions` | Control plane |
| `/api/workspaces/:id/config` | Responds directly with `{ region, wsUrl }` |
| `/api/workspaces/:id/*` | Regional backend (region resolved via KV) |

WebSocket connections bypass the router entirely. The frontend fetches `/api/workspaces/:id/config` to get the regional WebSocket URL (e.g. `wss://ws-eu.threa.io`), then connects directly.

---

## Frontend

**What:** React 19 SPA — the user interface for the main application.

**Deployed on:** Cloudflare Pages at `app.threa.io`.

**Deploy trigger:** Manual (`bun run build && bunx wrangler pages deploy dist --project-name threa`).

**Key infrastructure dependencies:**
- Cloudflare Pages (static hosting + SPA routing via `_redirects`)

**Talks to:**
- Workspace router via relative fetch (`/api/...`, cookie auth)
- Regional backend directly via WebSocket (`wss://ws-eu.threa.io`, cookie auth)

**Stack:** React 19, Vite 6, TailwindCSS, Shadcn UI (Radix), TanStack Query v5, TipTap v3 (editor), socket.io-client, Dexie (IndexedDB for offline drafts).

**Key patterns:**
- Cache-only observer pattern for TanStack Query (see `CLAUDE.md` Frontend Patterns)
- Subscribe-then-bootstrap for real-time data; re-bootstraps on socket reconnect (INV-53)
- No configurable API base URL — relies on the workspace router handling `/api/*` in production, Vite proxy in dev

---

## Workspace Router

**What:** Thin edge routing layer that delegates API requests to the correct regional backend or the control plane.

**Deployed on:** Cloudflare Workers at `app.threa.io/api/*`.

**Deploy trigger:** Manual (`bunx wrangler deploy --config wrangler.production.toml`).

**Key infrastructure dependencies:**
- Cloudflare KV (`WORKSPACE_REGIONS` namespace) — caches workspace-to-region mappings

**Talks to:**
- Control plane (auth routes, workspace list/create, region resolution on KV cache miss)
- Regional backend (workspace-scoped API requests)

**How region resolution works:**
1. Extract `workspaceId` from URL path
2. Check Cloudflare KV for cached `workspaceId -> region` mapping
3. On cache miss: call control plane at `GET /internal/workspaces/:id/region`, cache result in KV
4. Proxy the request to the resolved region's backend URL

**Auth forwarding:** Passes through the browser's `Cookie` header (session cookie `wos_session`) and all standard headers. The downstream service validates the session.

**Inter-service auth:** Uses `INTERNAL_API_KEY` in a custom header (`X-Internal-API-Key`) when calling the control plane's internal endpoints.

---

## Control Plane

**What:** Small, centralised server handling concerns that must be global: authentication, workspace creation, region assignment, invitation shadows, and workspace-to-region KV sync.

**Deployed on:** Railway (auto-deploy on push to `main`). Docker image from `Dockerfile.control-plane`.

**Deploy trigger:** Automatic on merge to `main`.

**Key infrastructure dependencies:**
- PostgreSQL (own `control_plane` database on the shared Railway Postgres instance) — stores workspace records and outbox
- WorkOS — OAuth/SSO authentication provider
- Cloudflare KV — writes workspace-to-region mappings so the router can resolve them at the edge

**Public endpoints (proxied through workspace router):**
- `GET /api/auth/login` — initiate WorkOS OAuth flow
- `ALL /api/auth/callback` — OAuth callback
- `GET /api/auth/logout` — clear session
- `GET /api/auth/me` — current user
- `GET /api/workspaces` — list user's workspaces
- `POST /api/workspaces` — create workspace (assigns region, triggers provisioning)
- `GET /api/regions` — available regions

**Internal endpoints (called by workspace router and regional backend):**
- `GET /internal/workspaces/:id/region` — resolve workspace region (used by router on KV miss)
- `POST /internal/invitation-shadows` — create invitation shadow (called by backend)
- `PATCH /internal/invitation-shadows/:id` — update invitation shadow

**Workspace creation flow:**
1. User calls `POST /api/workspaces` with a name and selected region
2. Control plane stores workspace record in its database
3. Outbox event triggers `provisionRegional` — calls the regional backend's `POST /internal/workspaces`
4. Outbox event triggers `syncToKv` — writes the workspace-to-region mapping to Cloudflare KV

---

## Backend

**What:** Regional application server running core domain logic — messaging, streams, AI agents, search, memos, file processing, and real-time event delivery.

**Deployed on:** Railway (auto-deploy on push to `main`). Docker image from `Dockerfile.backend`.

**Deploy trigger:** Automatic on merge to `main`.

**Key infrastructure dependencies:**
- PostgreSQL 17 + pgvector (regional `railway` database) — all domain data, event sourcing, job queue, outbox
- AWS S3 (regional bucket, e.g. `eu-north-1`) — file uploads (avatars, attachments)
- OpenRouter — AI model gateway (routes to Anthropic, OpenAI, etc.)
- WorkOS — session cookie validation (shared auth with control plane)
- Langfuse — AI observability/telemetry (OTEL-based)

**Talks to:**
- Control plane (create/update invitation shadows via internal endpoints)
- Frontend clients (HTTP API on port 8080 via Railway, WebSocket on `wss://ws-eu.threa.io`)

**Internal endpoints (called by control plane):**
- `POST /internal/workspaces` — provision a new workspace in this region
- `POST /internal/invitations/:id/accept` — accept an invitation

**Key subsystems:**

| Subsystem | What it does |
|---|---|
| Express HTTP API | REST endpoints for all domain features, validated with Zod |
| Socket.io | Real-time event delivery, room-based broadcasting, cookie auth |
| Outbox dispatcher | PostgreSQL NOTIFY/LISTEN; fans out committed events to 14 handlers |
| Job queue | PostgreSQL-backed background processing (AI, embeddings, file processing) |
| Event sourcing | `stream_events` as append-only log, `messages` as read projection |
| AI wrapper (`createAI`) | Unified interface over Vercel AI SDK + LangChain, with cost tracking and budgets |

**Feature domains:** messaging, streams, agents (companion/persona/researcher), memos (GAM), search (semantic + text), attachments, conversations, invitations, activity feed, commands, emoji, AI usage tracking, user preferences, workspaces.

---

## Inter-Service Authentication

Services authenticate to each other using a shared `INTERNAL_API_KEY` sent in the `X-Internal-API-Key` header. User-facing auth uses WorkOS session cookies (`wos_session`) set on `.threa.io` so they're valid across subdomains.

```
Browser -> Workspace Router: Cookie (wos_session)
Workspace Router -> Control Plane: Cookie passthrough + INTERNAL_API_KEY (for /internal/*)
Workspace Router -> Backend: Cookie passthrough
Control Plane -> Backend: INTERNAL_API_KEY
Backend -> Control Plane: INTERNAL_API_KEY
Browser -> Backend (WebSocket): Cookie (wos_session)
```

---

## Infrastructure Summary

| Infrastructure | Used by | Purpose |
|---|---|---|
| Cloudflare Pages | Frontend | Static SPA hosting |
| Cloudflare Workers | Workspace Router | Edge API routing |
| Cloudflare KV | Workspace Router, Control Plane | Workspace-to-region cache |
| Railway | Backend, Control Plane, PostgreSQL | Application hosting |
| PostgreSQL 17 + pgvector | Backend (`railway` db), Control Plane (`control_plane` db) | All persistent state |
| AWS S3 | Backend | File storage (per-region buckets) |
| OpenRouter | Backend | AI model gateway |
| WorkOS | Control Plane, Backend | Authentication (OAuth/SSO) |
| Langfuse | Backend | AI telemetry and observability |

---

## Multi-Region Design

The architecture is designed for multi-region from the start, though currently only `eu-north-1` is active:

- Each region gets its own Railway backend instance with its own PostgreSQL database and S3 bucket
- The control plane is global and assigns workspaces to regions at creation time
- The workspace router resolves regions at the edge via Cloudflare KV and proxies to the correct backend
- WebSocket connections go directly to the regional backend (no routing through Workers)
- Terraform in `infra/aws/` defines per-region S3 infrastructure (`us-east-1` module exists but is commented out)
