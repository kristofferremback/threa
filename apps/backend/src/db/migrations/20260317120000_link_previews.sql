-- Link previews: cached metadata for URLs found in messages
-- Supports website, PDF, and image content types

CREATE TABLE IF NOT EXISTS link_previews (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    url TEXT NOT NULL,
    normalized_url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    image_url TEXT,
    favicon_url TEXT,
    site_name TEXT,
    content_type TEXT NOT NULL DEFAULT 'website',
    status TEXT NOT NULL DEFAULT 'pending',
    fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS link_previews_workspace_normalized_url
    ON link_previews (workspace_id, normalized_url);

CREATE INDEX IF NOT EXISTS link_previews_status
    ON link_previews (status) WHERE status = 'pending';

-- Junction: which previews appear in which messages
CREATE TABLE IF NOT EXISTS message_link_previews (
    message_id TEXT NOT NULL,
    link_preview_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (message_id, link_preview_id)
);

CREATE INDEX IF NOT EXISTS message_link_previews_message_id
    ON message_link_previews (message_id);

-- Per-user dismissals of link previews
CREATE TABLE IF NOT EXISTS user_link_preview_dismissals (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    link_preview_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id, message_id, link_preview_id)
);
