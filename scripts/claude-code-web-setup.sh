#!/usr/bin/env bash
# Claude Code Web sandbox setup script.
# Paste into CC web Settings > Setup Script. Runs as root before repo clone.
# Keep this MINIMAL — only things that block session start.
# Everything else is lazy-loaded via scripts/lazy-setup.sh after clone.

# ─── PostgreSQL ───────────────────────────────────────────────────────────────

pg_version=$(pg_lsclusters -h 2>/dev/null | awk '{print $1; exit}')
if [ -n "$pg_version" ]; then
  pg_ctlcluster "$pg_version" main start 2>/dev/null || true

  pg_hba="/etc/postgresql/$pg_version/main/pg_hba.conf"
  if ! grep -q '# claude-code-web' "$pg_hba" 2>/dev/null; then
    sed -i '/^# IPv4 local connections:/a host    all    all    127.0.0.1/32    md5    # claude-code-web' "$pg_hba"
    pg_ctlcluster "$pg_version" main reload
  fi

  su - postgres -c "psql -v ON_ERROR_STOP=0" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'threa') THEN
    CREATE ROLE threa WITH LOGIN PASSWORD 'threa' CREATEDB;
  END IF;
END $$;
SQL
  su - postgres -c "createdb -O threa threa 2>/dev/null || true"
  su - postgres -c "createdb -O threa threa_test 2>/dev/null || true"
  for db in threa threa_test; do
    su - postgres -c "psql -d $db -c 'CREATE EXTENSION IF NOT EXISTS vector;'" 2>/dev/null || true
  done
fi

# ─── Marker ───────────────────────────────────────────────────────────────────

touch /tmp/.claude-code-web
exit 0
