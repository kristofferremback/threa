#!/usr/bin/env bash
set -euo pipefail

echo "==> Codex cloud setup"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
ENV_TEMPLATE=".env.remote-dev"

require_bun() {
  if ! command -v bun >/dev/null 2>&1; then
    echo "Bun is required for this repo. Install Bun, then rerun scripts/codex-cloud-setup.sh." >&2
    return 1
  fi
}

if [ ! -f "$ENV_TEMPLATE" ]; then
  echo "Missing $ENV_TEMPLATE. Restore the shared remote-dev env template, then rerun setup." >&2
  exit 1
fi

cp "$ENV_TEMPLATE" .env
echo "==> Copied $ENV_TEMPLATE -> .env"

echo "==> Skipping Docker startup in Codex Cloud; Docker-backed tests should run in CI"

require_bun

echo "==> Installing dependencies with bun"
rm -rf node_modules
bun install

echo "==> Setup complete"
