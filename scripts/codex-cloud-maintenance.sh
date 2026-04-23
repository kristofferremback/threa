#!/usr/bin/env bash
set -euo pipefail

echo "==> Codex cloud maintenance"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Refresh the dev env on resumed cached containers.
if [ -f .env.codex-cloud ]; then
  cp .env.codex-cloud .env
  echo "==> Refreshed .env from .env.codex-cloud"
fi

# Ensure local services are up after branch checkout or cache resume.
if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
  echo "==> Ensuring docker compose services are running"
  docker compose up -d --wait || docker compose up -d
fi

# Reconcile dependencies in case the branch changed lockfiles or package manifests.
if command -v bun >/dev/null 2>&1; then
  echo "==> Syncing bun dependencies"
  bun install
elif command -v pnpm >/dev/null 2>&1; then
  echo "==> Syncing pnpm dependencies"
  pnpm install
elif command -v npm >/dev/null 2>&1; then
  echo "==> Syncing npm dependencies"
  npm install
else
  echo "==> No supported package manager found; skipping dependency sync"
fi

echo "==> Maintenance complete"
