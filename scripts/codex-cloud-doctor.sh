#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Codex cloud doctor"

check() {
  local name="$1"
  local cmd="$2"

  if eval "$cmd" >/dev/null 2>&1; then
    echo "[ok] $name"
  else
    echo "[warn] $name"
  fi
}

check "bun installed" "command -v bun"
check "docker installed" "command -v docker"
check "docker daemon reachable" "docker info"
check ".env present" "test -f .env"
check "dependencies installed" "test -d node_modules"
check "postgres container running" "docker compose ps postgres | grep -q running"
check "minio container running" "docker compose ps minio | grep -q running"

echo

echo "Suggested next step: bun run dev"
