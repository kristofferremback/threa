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

start_docker_daemon() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  echo "==> Starting Docker daemon"
  HTTP_PROXY="${https_proxy:-}" HTTPS_PROXY="${https_proxy:-}" NO_PROXY="${no_proxy:-}" \
    nohup dockerd --host unix:///var/run/docker.sock >/tmp/dockerd.log 2>&1 &

  for _ in $(seq 1 45); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Docker daemon failed to become ready; see /tmp/dockerd.log" >&2
  return 1
}

compose_up() {
  if docker compose up --help | grep -q -- '--wait'; then
    docker compose up -d --wait
  else
    docker compose up -d
  fi
}

if [ ! -f "$ENV_TEMPLATE" ]; then
  echo "Missing $ENV_TEMPLATE. Restore the shared remote-dev env template, then rerun setup." >&2
  exit 1
fi

cp "$ENV_TEMPLATE" .env
echo "==> Copied $ENV_TEMPLATE -> .env"

if command -v dockerd >/dev/null 2>&1 && command -v docker >/dev/null 2>&1; then
  start_docker_daemon
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to start the local Postgres and MinIO services." >&2
  exit 1
fi

if [ -f docker-compose.yml ]; then
  echo "==> Starting docker compose services"
  compose_up
fi

require_bun

echo "==> Installing dependencies with bun"
rm -rf node_modules
bun install

echo "==> Setup complete"
