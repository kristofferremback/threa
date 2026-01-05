-- =============================================================================
-- User Preferences
-- Workspace-scoped user preferences that sync across devices in real-time
-- =============================================================================

CREATE TABLE user_preferences (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,

    -- Display
    theme TEXT NOT NULL DEFAULT 'system',              -- light | dark | system
    message_display TEXT NOT NULL DEFAULT 'comfortable', -- compact | comfortable

    -- Localization (independent of each other per user preference)
    date_format TEXT NOT NULL DEFAULT 'YYYY-MM-DD',    -- YYYY-MM-DD | DD/MM/YYYY | MM/DD/YYYY
    time_format TEXT NOT NULL DEFAULT '24h',           -- 24h | 12h
    timezone TEXT NOT NULL DEFAULT 'UTC',              -- IANA timezone
    language TEXT NOT NULL DEFAULT 'en',               -- for future i18n

    -- Notifications
    notification_level TEXT NOT NULL DEFAULT 'all',    -- all | mentions | none

    -- UI state
    sidebar_collapsed BOOLEAN NOT NULL DEFAULT FALSE,

    -- Complex preferences as JSONB
    keyboard_shortcuts JSONB NOT NULL DEFAULT '{}',
    accessibility JSONB NOT NULL DEFAULT '{"reducedMotion":false,"highContrast":false,"fontSize":"medium","fontFamily":"system"}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (workspace_id, user_id)
);

-- Index for listing all preferences for a user across workspaces
CREATE INDEX idx_user_preferences_user ON user_preferences (user_id);
