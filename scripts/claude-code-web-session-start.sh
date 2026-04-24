#!/usr/bin/env bash
# Claude Code Web SessionStart hook.
# Wired up from .claude/settings.json; runs on every session start/resume.
#
# Goal: keep node_modules healthy across snapshot restores without paying the
# ~150s full reinstall on every resume. We stamp node_modules with the
# bun.lock hash after a successful install, and fast-path when the stamp
# still matches the current lockfile.

set -u

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

[ -f .env.remote-dev ] || { echo "Missing .env.remote-dev" >&2; exit 1; }
cp -n .env.remote-dev .env
docker compose up -d --wait

LOCK_HASH=$(sha256sum bun.lock 2>/dev/null | awk '{print $1}')
STAMP=node_modules/.install-stamp

if [ -n "$LOCK_HASH" ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$LOCK_HASH" ]; then
  exit 0
fi

rm -rf node_modules apps/*/node_modules packages/*/node_modules
bun install || exit 1
echo "$LOCK_HASH" > "$STAMP"
