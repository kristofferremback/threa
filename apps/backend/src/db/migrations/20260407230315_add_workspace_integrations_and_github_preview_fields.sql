-- Add workspace-level third-party integrations and richer link preview payload fields.
-- GitHub is the first provider; the schema stays provider-extensible for future integrations.

CREATE TABLE IF NOT EXISTS workspace_integrations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'inactive',
    credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    installed_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_integrations_workspace_provider
    ON workspace_integrations (workspace_id, provider);

CREATE INDEX IF NOT EXISTS workspace_integrations_workspace_status
    ON workspace_integrations (workspace_id, status);

-- Extend link previews so provider-specific rich preview payloads can be cached
-- inside the existing preview pipeline instead of creating a parallel system.
ALTER TABLE link_previews ADD COLUMN IF NOT EXISTS preview_type TEXT;
ALTER TABLE link_previews ADD COLUMN IF NOT EXISTS preview_data JSONB;
ALTER TABLE link_previews ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
