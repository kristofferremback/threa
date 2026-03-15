# Claude Code Web

How to develop Threa in [Claude Code web](https://claude.ai/code) sandbox sessions.

## Sandbox Environment

Ubuntu 24.04 VM with Docker 29, Bun, Node 22, and git pre-installed. No systemd. The VM resets between every conversation turn — only the git working directory persists.

## Setup Script (`scripts/claude-code-web-setup.sh`)

Paste this script into **CC web Settings > Setup Script**. It runs as root on each new session and:

- Starts the Docker daemon with the egress proxy (`$https_proxy`) so it can pull images
- Downloads and installs the `gh` CLI binary from GitHub Releases (apt is unreachable)

## SessionStart Hook

The `.claude/settings.json` SessionStart hook runs after clone and:

- Copies `.env.claude-code-web` to `.env` (if not already present)
- Runs `docker compose up -d --wait` to start PostgreSQL 17 with pgvector and MinIO
- Runs `bun install`

This uses the same `docker-compose.yml` and ports as local dev (Postgres 5454, MinIO 9099).

## Environment

`.env.claude-code-web` is copied to `.env` automatically. It matches `docker-compose.yml` port mappings (5454 for Postgres, 9099 for MinIO) with stub auth enabled.

## Manual UI Configuration

- **Network allowlist:** Add `openrouter.ai` if AI features are needed.
- **Secrets:** Environment variables like `OPENROUTER_API_KEY` and `WORKOS_*` go in the CC web secrets panel, not in files.

## Limitations

- **No browser tests.** Playwright and browser-based E2E tests cannot run in the sandbox. Use GitHub Actions CI for those (`bun run test:e2e`).
- **No apt access.** `archive.ubuntu.com` DNS resolution fails from the sandbox. System packages must be pre-installed or downloaded as binaries through the egress proxy.
