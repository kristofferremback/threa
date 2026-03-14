# Claude Code Web

How to develop Threa in [Claude Code web](https://claude.ai/code) sandbox sessions.

## Sandbox Environment

Ubuntu 24.04 VM with PostgreSQL 16 (not running), Bun, Node 22, and git pre-installed. No systemd. The VM resets between every conversation turn — only the git working directory persists.

## Setup Script (`scripts/claude-code-web-setup.sh`)

Paste this script into **CC web Settings > Setup Script**. It runs as root on each new session and:

- Starts PostgreSQL 16 via `pg_ctlcluster`
- Creates user `threa`/`threa`, databases `threa` and `threa_test`, and enables pgvector
- Enables md5 password auth for local TCP connections in `pg_hba.conf`
- Downloads and starts MinIO on port 9000 (background process, `/tmp/minio-data`)
- Installs the `gh` CLI for PR workflows

Postgres runs directly on port 5432 (not the 5454/5455 Docker mappings used in local dev).

## Dependency Installation

`bun install` fails in the sandbox due to the HTTP proxy not supporting HTTPS CONNECT tunneling. The `.claude/settings.json` SessionStart hook uses `npm install` as a fallback instead.

## Environment

Copy `.env.claude-code-web` to `.env` for sandbox sessions. It points at localhost:5432 (Postgres) and localhost:9000 (MinIO) with stub auth enabled.

## Manual UI Configuration

- **Network allowlist:** Add `openrouter.ai` if AI features are needed.
- **Secrets:** Environment variables like `OPENROUTER_API_KEY` and `WORKOS_*` go in the CC web secrets panel, not in files.

## Limitations

- **No browser tests.** Playwright and browser-based E2E tests cannot run in the sandbox. Use GitHub Actions CI for those (`bun run test:e2e`).
