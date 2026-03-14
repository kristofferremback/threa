# Deployment

How production deploys work for each component of the Threa stack.

## Overview

| Component        | Platform           | Trigger                                                           | URL                                            |
| ---------------- | ------------------ | ----------------------------------------------------------------- | ---------------------------------------------- |
| Backend          | Railway            | Auto-deploy on push to `main`                                     | `backend-production-6634.up.railway.app`       |
| Control-plane    | Railway            | Auto-deploy on push to `main`                                     | `control-plane-production-7495.up.railway.app` |
| PostgreSQL       | Railway            | Manual (watch patterns restrict to `Dockerfile.postgres` changes) | `postgres.railway.internal:5432`               |
| Workspace-router | Cloudflare Workers | Manual `wrangler deploy`                                          | `app.threa.io/api/*`                           |
| Frontend         | Cloudflare Pages   | Manual `wrangler pages deploy`                                    | `app.threa.io`                                 |

## Railway Services (Auto-Deploy)

Backend and control-plane auto-deploy when commits land on `main`. Railway watches the GitHub repo and builds from their respective Dockerfiles.

### Build Process

Both services use Bun and share the same build pattern:

1. Railway detects the push and starts a Docker build with repo root as context
2. The Dockerfile copies workspace `package.json` files first (cache-friendly layer ordering)
3. `bun install --frozen-lockfile --production` installs dependencies
4. Source code is copied (workspace packages + the app)
5. Container starts with `bun apps/<service>/src/index.ts`

```
Dockerfile.backend       → backend service
Dockerfile.control-plane → control-plane service
```

No explicit build step — Bun runs TypeScript directly.

### Migrations

Both services run database migrations automatically on startup before accepting traffic:

- **Backend**: `apps/backend/src/db/migrations/*.sql` → runs against `railway` database
- **Control-plane**: `apps/control-plane/src/db/migrations/*.sql` → runs against `control_plane` database

Migrations acquire a PostgreSQL advisory lock to prevent concurrent execution during rolling deploys. They are append-only (no down migrations).

### Health Checks

Railway polls these endpoints to determine when a deployment is ready:

- Backend: `GET /health` → `{ status: "ok" }`
- Control-plane: `GET /health` → `{ status: "ok" }`

The `/readyz` endpoint provides more detail (pool stats) but isn't used for Railway health checks.

### What Triggers a Deploy

Any push to `main` triggers a rebuild of **both** backend and control-plane. Railway doesn't have per-service watch paths for repo-linked services — both rebuild even if only one changed.

The PostgreSQL service has watch patterns set to `["Dockerfile.postgres"]`, so it only rebuilds when the Dockerfile itself changes (not on regular code pushes).

### Deploy Sequence

On push to `main`:

1. Railway queues builds for backend and control-plane in parallel
2. Each service builds its Docker image (~60-90s)
3. New container starts, runs migrations, begins listening
4. Railway health check passes → traffic shifts to new container
5. Old container receives SIGTERM → graceful shutdown (drains connections, closes pools)

Zero-downtime: Railway keeps the old container running until the new one passes health checks.

## PostgreSQL

PostgreSQL uses a custom Dockerfile (`Dockerfile.postgres`) that extends Railway's Postgres 17 image with pgvector:

```dockerfile
FROM ghcr.io/railwayapp-templates/postgres-ssl:17
RUN apt-get update && \
    apt-get install -y --no-install-recommends postgresql-17-pgvector \
    && rm -rf /var/lib/apt/lists/*
```

Data persists on a Railway volume across container restarts.

**Watch patterns** are set to `["Dockerfile.postgres"]` so the database container only rebuilds when the Dockerfile changes. Without this, every push to `main` would restart the database and drop all connections.

Both services share the same PostgreSQL instance but use different databases:

- Backend → `railway`
- Control-plane → `control_plane`

## Cloudflare Workers (Workspace-Router)

The workspace-router is a Cloudflare Worker that routes API requests. It is **not** auto-deployed.

### Deploy

```bash
cd apps/workspace-router
bunx wrangler deploy --config wrangler.production.toml
```

### Secrets

`INTERNAL_API_KEY` is set separately (not in config files):

```bash
cd apps/workspace-router
bunx wrangler secret put INTERNAL_API_KEY --config wrangler.production.toml
```

### Configuration

Production config lives in `apps/workspace-router/wrangler.production.toml`:

- `REGIONS` — JSON mapping region names to backend URLs (apiUrl + wsUrl)
- `CONTROL_PLANE_URL` — public URL of the control-plane
- KV namespace binding `WORKSPACE_REGIONS` for workspace→region caching

### What It Routes

| Pattern                       | Destination                               |
| ----------------------------- | ----------------------------------------- |
| `/api/auth/*`                 | Control-plane                             |
| `/api/workspaces` (GET, POST) | Control-plane                             |
| `/api/regions`                | Control-plane                             |
| `/api/workspaces/:id/config`  | Returns `{ region, wsUrl }` directly      |
| `/api/workspaces/:id/*`       | Regional backend (looked up via KV cache) |
| `/readyz`                     | Returns 200 (local health check)          |

## Cloudflare Pages (Frontend)

The frontend is a React 19 + Vite SPA deployed to Cloudflare Pages. It is **not** auto-deployed.

### Deploy

```bash
cd apps/frontend
bun run build
bunx wrangler pages deploy dist --project-name threa
```

### SPA Routing

`apps/frontend/public/_redirects` contains:

```
/* /index.html 200
```

This ensures all routes serve `index.html` for client-side routing.

### Domain Setup

The frontend and workspace-router share the same domain (`app.threa.io`). Cloudflare Workers Routes take priority over Pages, so:

- `/api/*` → handled by workspace-router (Workers Route)
- Everything else → handled by frontend (Pages)

The frontend uses relative paths (`fetch("/api/...")`) with no configurable API base URL.

## Inter-Service Communication

All services communicate over Railway's private network at port **8080** (Railway's injected PORT):

```
Frontend (app.threa.io)
    │
    ├─ /api/auth/* ──────────► Workspace-Router ──► Control-plane (:8080)
    ├─ /api/workspaces/* ────► Workspace-Router ──► Regional backend (:8080)
    └─ wss://ws-eu.threa.io ► Backend directly (cookie auth)

Control-plane ◄──────────────► Backend (bidirectional over :8080)
    │                              │
    └── REGIONS config             └── CONTROL_PLANE_URL
        internalUrl:8080               http://cp.railway.internal:8080
```

Key env vars for inter-service wiring:

| Service       | Variable            | Value                                                                   |
| ------------- | ------------------- | ----------------------------------------------------------------------- |
| Backend       | `CONTROL_PLANE_URL` | `http://control-plane.railway.internal:8080`                            |
| Control-plane | `REGIONS`           | `{"eu-north-1":{"internalUrl":"http://backend.railway.internal:8080"}}` |
| Both          | `INTERNAL_API_KEY`  | Shared secret for auth header                                           |

**Critical:** Railway services always listen on port 8080 regardless of the `EXPOSE` directive in Dockerfiles. Internal URLs must use `:8080`.

## CI Pipeline

GitHub Actions runs on every PR and push to `main`:

### CI (`.github/workflows/ci.yml`)

- Lints frontend (ESLint)
- Runs full test suite against Postgres 17 + pgvector + MinIO
- Backend unit/integration tests, control-plane tests, workspace-router tests, frontend tests

### Browser Tests (`.github/workflows/browser-tests.yml`)

- Playwright E2E tests in Chromium
- Sharded across 2 parallel runners
- Runs on push to `main` and PRs

Both workflows must pass before merging.

## Environment Variables

See `.env.example` at the repo root for the full list with descriptions. The critical production-only variables are:

### Backend

| Variable                                                             | Description                                  |
| -------------------------------------------------------------------- | -------------------------------------------- |
| `DATABASE_URL`                                                       | PostgreSQL connection string                 |
| `NODE_ENV`                                                           | `production`                                 |
| `CORS_ALLOWED_ORIGINS`                                               | `https://app.threa.io`                       |
| `COOKIE_DOMAIN`                                                      | `.threa.io`                                  |
| `WORKOS_API_KEY`                                                     | WorkOS API key                               |
| `WORKOS_CLIENT_ID`                                                   | WorkOS OAuth client ID                       |
| `WORKOS_REDIRECT_URI`                                                | `https://app.threa.io/api/auth/callback`     |
| `WORKOS_COOKIE_PASSWORD`                                             | 32+ char secret for sealed sessions          |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | AWS S3 for file uploads                      |
| `OPENROUTER_API_KEY`                                                 | AI model access                              |
| `CONTROL_PLANE_URL`                                                  | `http://control-plane.railway.internal:8080` |
| `INTERNAL_API_KEY`                                                   | Shared inter-service secret                  |
| `REGION`                                                             | `eu-north-1`                                 |

### Control-Plane

| Variable               | Description                                                  |
| ---------------------- | ------------------------------------------------------------ |
| `DATABASE_URL`         | PostgreSQL connection string (uses `control_plane` database) |
| `NODE_ENV`             | `production`                                                 |
| `CORS_ALLOWED_ORIGINS` | `https://app.threa.io`                                       |
| `COOKIE_DOMAIN`        | `.threa.io`                                                  |
| `WORKOS_*`             | Same 4 WorkOS values as backend                              |
| `INTERNAL_API_KEY`     | Same shared secret                                           |
| `REGIONS`              | JSON with regional backend internal URLs                     |
| `CLOUDFLARE_KV_*`      | Cloudflare KV credentials for workspace→region cache sync    |

## Rollback

### Railway Services

Railway keeps deployment history. To roll back:

```bash
railway redeploy --service backend --yes    # rebuild from same commit
```

Or use the Railway dashboard to redeploy a previous deployment.

### Cloudflare Workers

```bash
cd apps/workspace-router
git checkout <previous-commit>
bunx wrangler deploy --config wrangler.production.toml
```

### Cloudflare Pages

```bash
cd apps/frontend
git checkout <previous-commit>
bun run build
bunx wrangler pages deploy dist --project-name threa
```

### Database Migrations

Migrations are append-only and forward-only. To undo a migration, write a new migration that reverses the change.

## Claude Code Web

Claude Code web sessions run in an Ubuntu 24.04 sandbox VM that resets between conversation turns — only the git working directory persists.

### Setup Script (`scripts/claude-code-web-setup.sh`)

Paste this script into **CC web Settings > Setup Script**. It runs as root on each new session and:

- Starts PostgreSQL 16 via `pg_ctlcluster` (no systemd in the sandbox)
- Creates user `threa`/`threa`, databases `threa` and `threa_test`, and enables pgvector
- Enables md5 password auth for local TCP connections in `pg_hba.conf`
- Downloads and starts MinIO on port 9000 (background process, `/tmp/minio-data`)
- Installs the `gh` CLI for PR workflows

Postgres runs directly on port 5432 (not the 5454/5455 Docker mappings used in local dev).

### Dependency Installation

`bun install` fails in the sandbox due to the HTTP proxy not supporting HTTPS CONNECT tunneling. The `.claude/settings.json` SessionStart hook uses `npm install` as a fallback instead.

### Environment

Copy `.env.claude-code-web` to `.env` for sandbox sessions. It points at localhost:5432 (Postgres) and localhost:9000 (MinIO) with stub auth enabled.

### Limitations

- **No browser tests.** Playwright and browser-based E2E tests cannot run in the sandbox. Use GitHub Actions CI for those (`bun run test:e2e`).
- **Network allowlist.** Add `openrouter.ai` to the CC web network allowlist if AI features are needed.
- **Secrets.** Environment variables like `OPENROUTER_API_KEY` and `WORKOS_*` go in the CC web secrets panel, not in files.
