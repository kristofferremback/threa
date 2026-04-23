#!/usr/bin/env bash
set -euo pipefail

echo "==> Codex cloud maintenance"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_bun() {
  if ! command -v bun >/dev/null 2>&1; then
    echo "Bun is required for this repo. Install Bun, then rerun scripts/codex-cloud-maintenance.sh." >&2
    return 1
  fi
}

compose_up() {
  if docker compose up --help | grep -q -- '--wait'; then
    docker compose up -d --wait
  else
    docker compose up -d
  fi
}

# Refresh the dev env on resumed cached containers.
if [ -f .env.codex-cloud ]; then
  cp .env.codex-cloud .env
  echo "==> Refreshed .env from .env.codex-cloud"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to start the local Postgres and MinIO services." >&2
  exit 1
fi

# Ensure local services are up after branch checkout or cache resume.
if [ -f docker-compose.yml ]; then
  echo "==> Ensuring docker compose services are running"
  compose_up
fi

require_bun

# Reconcile dependencies in case the branch changed lockfiles or package manifests.
echo "==> Syncing bun dependencies"
bun install

echo "==> Maintenance complete"
