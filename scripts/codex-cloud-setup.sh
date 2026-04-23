#!/usr/bin/env bash
set -euo pipefail

echo "==> Codex cloud setup"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env.codex-cloud ]; then
  cp .env.codex-cloud .env
  echo "==> Copied .env.codex-cloud -> .env"
fi

if command -v dockerd >/dev/null 2>&1 && command -v docker >/dev/null 2>&1; then
  if ! docker info >/dev/null 2>&1; then
    echo "==> Starting Docker daemon"
    nohup dockerd --host unix:///var/run/docker.sock >/tmp/dockerd.log 2>&1 &

    for _ in $(seq 1 45); do
      if docker info >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
  fi
fi

if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
  echo "==> Starting docker compose services"
  docker compose up -d --wait || docker compose up -d
fi

if command -v bun >/dev/null 2>&1; then
  echo "==> Installing dependencies with bun"
  rm -rf node_modules
  bun install
elif command -v pnpm >/dev/null 2>&1; then
  echo "==> Installing dependencies with pnpm"
  rm -rf node_modules
  pnpm install
elif command -v npm >/dev/null 2>&1; then
  echo "==> Installing dependencies with npm"
  rm -rf node_modules
  npm install
else
  echo "==> No supported package manager found; skipping dependency install"
fi

echo "==> Setup complete"
