#!/usr/bin/env bash
# Claude Code Web sandbox setup script.
# Paste into CC web Settings > Setup Script. Runs as root on new sessions only.
# Idempotent — safe to run multiple times.
set -euo pipefail

# ─── PostgreSQL ───────────────────────────────────────────────────────────────

# Start whatever PG version is installed (sandbox ships PG 16)
PG_VERSION=$(pg_lsclusters -h 2>/dev/null | awk '{print $1; exit}')
if [ -z "$PG_VERSION" ]; then
  echo "ERROR: No PostgreSQL cluster found" >&2
  exit 1
fi

pg_ctlcluster "$PG_VERSION" main start 2>/dev/null || true

# Enable password auth for local TCP connections
PG_HBA="/etc/postgresql/$PG_VERSION/main/pg_hba.conf"
if ! grep -q '# claude-code-web' "$PG_HBA" 2>/dev/null; then
  # Insert md5 rule for local TCP before the default lines
  sed -i '/^# IPv4 local connections:/a host    all    all    127.0.0.1/32    md5    # claude-code-web' "$PG_HBA"
  pg_ctlcluster "$PG_VERSION" main reload
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
  su - postgres -c "psql -d $db -c 'CREATE EXTENSION IF NOT EXISTS vector;'"
done

# ─── MinIO ────────────────────────────────────────────────────────────────────

if ! command -v /usr/local/bin/minio &>/dev/null; then
  curl -fsSL https://dl.min.io/server/minio/release/linux-amd64/minio -o /usr/local/bin/minio
  chmod +x /usr/local/bin/minio
fi

if ! pgrep -x minio &>/dev/null; then
  mkdir -p /tmp/minio-data
  MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin \
    nohup /usr/local/bin/minio server /tmp/minio-data --address ":9000" \
    >/tmp/minio.log 2>&1 &
  echo "MinIO started on :9000 (pid $!)"
fi

# ─── gh CLI ───────────────────────────────────────────────────────────────────

if ! command -v gh &>/dev/null; then
  (type -p wget >/dev/null || apt-get update && apt-get install -y wget) \
    && mkdir -p -m 755 /etc/apt/keyrings \
    && out=$(mktemp) && wget -nv -O"$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    && cat "$out" | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      | tee /etc/apt/sources.list.d/github-cli.list >/dev/null \
    && apt-get update \
    && apt-get install -y gh
fi

echo "Claude Code Web setup complete."
