-- =============================================================================
-- User Preference Overrides
-- Sparse key-value storage for user preferences. Only stores overrides from
-- code-defined defaults, making default changes a code deploy not a migration.
-- =============================================================================

CREATE TABLE user_preference_overrides (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,              -- e.g., "theme", "accessibility.fontSize"
    value JSONB NOT NULL,           -- The override value (any JSON type)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (workspace_id, user_id, key)
);

-- Index for listing all overrides for a user across workspaces
CREATE INDEX idx_user_preference_overrides_user ON user_preference_overrides (user_id);
