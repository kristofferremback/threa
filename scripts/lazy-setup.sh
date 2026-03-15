#!/usr/bin/env bash
# Lazy setup for CC web — runs in background from SessionStart hook.
# Installs things that aren't needed immediately (MinIO, gh CLI).
# Each section is independent; failures don't block the session.

# ─── MinIO ────────────────────────────────────────────────────────────────────

if ! command -v /usr/local/bin/minio &>/dev/null; then
  _arch=$(dpkg --print-architecture 2>/dev/null || uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
  curl -fsSL --max-time 60 "https://dl.min.io/server/minio/release/linux-${_arch}/minio" \
    -o /usr/local/bin/minio && chmod +x /usr/local/bin/minio
fi

if command -v /usr/local/bin/minio &>/dev/null && ! pgrep -x minio &>/dev/null; then
  mkdir -p /tmp/minio-data
  MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin \
    nohup /usr/local/bin/minio server /tmp/minio-data --address ":9000" \
    >/tmp/minio.log 2>&1 &
fi

# ─── gh CLI ───────────────────────────────────────────────────────────────────

if ! command -v gh &>/dev/null; then
  (type -p wget >/dev/null || (apt-get update && apt-get install -y wget)) \
    && mkdir -p -m 755 /etc/apt/keyrings \
    && out=$(mktemp) \
    && wget -nv -O"$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    && cat "$out" | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null \
    && rm -f "$out" \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      | tee /etc/apt/sources.list.d/github-cli.list >/dev/null \
    && apt-get update \
    && apt-get install -y gh
fi

exit 0
