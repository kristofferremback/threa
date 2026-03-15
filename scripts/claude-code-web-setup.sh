#!/usr/bin/env bash
# Claude Code Web sandbox setup script.
# Paste into CC web Settings > Setup Script. Runs as root on new sessions only.
# Idempotent — safe to run multiple times.
#
# IMPORTANT: No "set -e" — each section is isolated so one failure
# doesn't prevent the rest from running or block session startup.

# ─── PostgreSQL ───────────────────────────────────────────────────────────────

setup_postgres() {
  # Start whatever PG version is installed (sandbox ships PG 16)
  local pg_version
  pg_version=$(pg_lsclusters -h 2>/dev/null | awk '{print $1; exit}')
  if [ -z "$pg_version" ]; then
    echo "WARN: No PostgreSQL cluster found, skipping PG setup" >&2
    return 1
  fi

  pg_ctlcluster "$pg_version" main start 2>/dev/null || true

  # Enable password auth for local TCP connections
  local pg_hba="/etc/postgresql/$pg_version/main/pg_hba.conf"
  if ! grep -q '# claude-code-web' "$pg_hba" 2>/dev/null; then
    sed -i '/^# IPv4 local connections:/a host    all    all    127.0.0.1/32    md5    # claude-code-web' "$pg_hba"
    pg_ctlcluster "$pg_version" main reload
  fi

  # Create user and databases (idempotent)
  su - postgres -c "psql -v ON_ERROR_STOP=0" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'threa') THEN
    CREATE ROLE threa WITH LOGIN PASSWORD 'threa' CREATEDB;
  END IF;
END $$;
SQL

  su - postgres -c "createdb -O threa threa 2>/dev/null || true"
  su - postgres -c "createdb -O threa threa_test 2>/dev/null || true"

  # Install pgvector extension on both databases
  for db in threa threa_test; do
    su - postgres -c "psql -d $db -c 'CREATE EXTENSION IF NOT EXISTS vector;'" 2>/dev/null || true
  done

  echo "PostgreSQL ready"
}

# ─── MinIO ────────────────────────────────────────────────────────────────────

setup_minio() {
  if ! command -v /usr/local/bin/minio &>/dev/null; then
    curl -fsSL --max-time 30 https://dl.min.io/server/minio/release/linux-amd64/minio -o /usr/local/bin/minio
    chmod +x /usr/local/bin/minio
  fi

  if ! pgrep -x minio &>/dev/null; then
    mkdir -p /tmp/minio-data
    MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin \
      nohup /usr/local/bin/minio server /tmp/minio-data --address ":9000" \
      >/tmp/minio.log 2>&1 &
    echo "MinIO started on :9000 (pid $!)"
  fi
}

# ─── gh CLI ───────────────────────────────────────────────────────────────────

setup_gh() {
  if command -v gh &>/dev/null; then return 0; fi

  (type -p wget >/dev/null || (apt-get update && apt-get install -y wget)) \
    && mkdir -p -m 755 /etc/apt/keyrings \
    && out=$(mktemp) && wget -nv -O"$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    && cat "$out" | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      | tee /etc/apt/sources.list.d/github-cli.list >/dev/null \
    && apt-get update \
    && apt-get install -y gh

  echo "gh CLI installed"
}

# ─── Run each section independently ──────────────────────────────────────────

setup_postgres || echo "WARN: PostgreSQL setup failed" >&2
setup_minio    || echo "WARN: MinIO setup failed" >&2
setup_gh       || echo "WARN: gh CLI setup failed" >&2

# ─── Marker ───────────────────────────────────────────────────────────────────

# SessionStart hook checks for this to skip npm install on local dev
touch /tmp/.claude-code-web

echo "Claude Code Web setup complete."

# Always exit 0 so CC web doesn't treat the session as failed
exit 0
