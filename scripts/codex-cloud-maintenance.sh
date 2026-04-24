#!/usr/bin/env bash
set -euo pipefail

echo "==> Codex cloud maintenance"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
ENV_TEMPLATE=".env.remote-dev"

require_bun() {
  if ! command -v bun >/dev/null 2>&1; then
    echo "Bun is required for this repo. Install Bun, then rerun scripts/codex-cloud-maintenance.sh." >&2
    return 1
  fi
}

# Refresh the dev env on resumed cached containers.
if [ ! -f "$ENV_TEMPLATE" ]; then
  echo "Missing $ENV_TEMPLATE. Restore the shared remote-dev env template, then rerun maintenance." >&2
  exit 1
fi

cp "$ENV_TEMPLATE" .env
echo "==> Refreshed .env from $ENV_TEMPLATE"

echo "==> Skipping Docker startup in Codex Cloud; Docker-backed tests should run in CI"

require_bun

# Reconcile dependencies in case the branch changed lockfiles or package manifests.
echo "==> Syncing bun dependencies"
bun install

echo "==> Maintenance complete"
