#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Codex cloud doctor"

failures=0

check() {
  local name="$1"
  shift
  local output=""

  if output="$("$@" 2>&1)"; then
    echo "[ok] $name"
  else
    echo "[fail] $name" >&2
    if [ -n "$output" ]; then
      printf '%s\n' "$output" >&2
    fi
    failures=$((failures + 1))
  fi
}

check "bun installed" command -v bun
check "docker installed" command -v docker
check "docker daemon reachable" docker info
check ".env present" test -f .env
check "dependencies installed" test -d node_modules
check "postgres container running" bash -c "docker compose ps --status running --services postgres | grep -qx postgres"
check "minio container running" bash -c "docker compose ps --status running --services minio | grep -qx minio"

echo

if [ "$failures" -gt 0 ]; then
  echo "Doctor found $failures failing check(s)." >&2
  exit 1
fi

echo "Suggested next step: bun run dev"
