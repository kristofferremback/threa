-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    workos_user_id TEXT UNIQUE,
    timezone TEXT,
    locale TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Socket.io attachments (for postgres adapter)
CREATE TABLE IF NOT EXISTS socket_io_attachments (
    id BIGSERIAL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    payload BYTEA
);
