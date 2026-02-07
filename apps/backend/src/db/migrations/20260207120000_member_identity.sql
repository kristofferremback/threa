-- Member Identity Migration
-- Establishes workspace members as first-class actors (INV-50).
-- Users become thin auth wrappers; members hold workspace-scoped identity.

-- =============================================================================
-- 1. Evolve workspace_members: add member identity columns
-- =============================================================================

ALTER TABLE workspace_members ADD COLUMN id TEXT;
ALTER TABLE workspace_members ADD COLUMN slug TEXT;
ALTER TABLE workspace_members ADD COLUMN timezone TEXT;
ALTER TABLE workspace_members ADD COLUMN locale TEXT;

-- Populate existing rows with member IDs
UPDATE workspace_members SET
  id = 'member_' || replace(gen_random_uuid()::text, '-', '');

-- Copy workspace-scoped fields from users
UPDATE workspace_members wm SET
  slug = u.slug,
  timezone = u.timezone,
  locale = u.locale
FROM users u WHERE wm.user_id = u.id;

-- Ensure slug for any members that didn't get one from users
UPDATE workspace_members SET
  slug = 'member-' || replace(gen_random_uuid()::text, '-', '')
WHERE slug IS NULL;

-- Apply constraints
ALTER TABLE workspace_members ALTER COLUMN id SET NOT NULL;
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_id_key UNIQUE (id);
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_ws_slug_key UNIQUE (workspace_id, slug);
ALTER TABLE workspace_members ALTER COLUMN slug SET NOT NULL;

-- Indexes for member lookup
CREATE INDEX idx_workspace_members_id ON workspace_members (id);
CREATE INDEX idx_workspace_members_slug ON workspace_members (workspace_id, slug);

-- Trigram index for member search (moved from users)
CREATE INDEX idx_workspace_members_slug_trgm
  ON workspace_members USING GIN (slug gin_trgm_ops);

-- =============================================================================
-- 2. Trim users table: remove workspace-scoped columns
-- =============================================================================

ALTER TABLE users DROP COLUMN slug;
ALTER TABLE users DROP COLUMN timezone;
ALTER TABLE users DROP COLUMN locale;

-- Drop now-unused indexes (the trgm index on slug was on users, now on members)
DROP INDEX IF EXISTS idx_users_slug;
DROP INDEX IF EXISTS idx_users_slug_trgm;

-- =============================================================================
-- 3. Update stream_members: user_id → member_id
-- =============================================================================

ALTER TABLE stream_members ADD COLUMN member_id TEXT;

UPDATE stream_members sm SET
  member_id = wm.id
FROM workspace_members wm
JOIN streams s ON s.workspace_id = wm.workspace_id
WHERE sm.stream_id = s.id AND sm.user_id = wm.user_id;

-- Handle any orphaned stream_members (shouldn't exist, but defensive)
DELETE FROM stream_members WHERE member_id IS NULL;

ALTER TABLE stream_members ALTER COLUMN member_id SET NOT NULL;

-- Rebuild PK: drop old, create new
ALTER TABLE stream_members DROP CONSTRAINT stream_members_pkey;
ALTER TABLE stream_members ADD PRIMARY KEY (stream_id, member_id);
ALTER TABLE stream_members DROP COLUMN user_id;

-- Recreate indexes
DROP INDEX IF EXISTS idx_stream_members_user;
DROP INDEX IF EXISTS idx_stream_members_pinned;
CREATE INDEX idx_stream_members_member ON stream_members (member_id);
CREATE INDEX idx_stream_members_pinned ON stream_members (member_id, pinned)
  WHERE pinned = TRUE;

-- =============================================================================
-- 4. Update messages: author_type 'user' → 'member'
-- =============================================================================

-- Update author_id for user-authored messages to use member_id
-- We need the workspace from the stream to look up the correct member
UPDATE messages m SET
  author_id = wm.id,
  author_type = 'member'
FROM streams s, workspace_members wm
WHERE m.stream_id = s.id
  AND wm.workspace_id = s.workspace_id
  AND wm.user_id = m.author_id
  AND m.author_type = 'user';

-- =============================================================================
-- 5. Update reactions: user_id → member_id
-- =============================================================================

ALTER TABLE reactions ADD COLUMN member_id TEXT;

UPDATE reactions r SET
  member_id = wm.id
FROM messages msg, streams s, workspace_members wm
WHERE r.message_id = msg.id
  AND s.id = msg.stream_id
  AND wm.workspace_id = s.workspace_id
  AND wm.user_id = r.user_id;

-- Handle orphaned reactions
DELETE FROM reactions WHERE member_id IS NULL;

ALTER TABLE reactions ALTER COLUMN member_id SET NOT NULL;

-- Rebuild PK
ALTER TABLE reactions DROP CONSTRAINT reactions_pkey;
ALTER TABLE reactions ADD PRIMARY KEY (message_id, member_id, emoji);
ALTER TABLE reactions DROP COLUMN user_id;

-- =============================================================================
-- 6. Update stream_events: actor_type 'user' → 'member'
-- =============================================================================

UPDATE stream_events se SET
  actor_id = wm.id,
  actor_type = 'member'
FROM streams s, workspace_members wm
WHERE se.stream_id = s.id
  AND wm.workspace_id = s.workspace_id
  AND wm.user_id = se.actor_id
  AND se.actor_type = 'user';

-- =============================================================================
-- 7. Update streams: created_by user_id → member_id
-- =============================================================================

UPDATE streams s SET
  created_by = wm.id
FROM workspace_members wm
WHERE wm.workspace_id = s.workspace_id AND wm.user_id = s.created_by;

-- =============================================================================
-- 8. Update workspaces: created_by user_id → member_id
-- =============================================================================

UPDATE workspaces w SET
  created_by = wm.id
FROM workspace_members wm
WHERE wm.workspace_id = w.id AND wm.user_id = w.created_by;

-- =============================================================================
-- 9. Update attachments: uploaded_by user_id → member_id
-- =============================================================================

UPDATE attachments a SET
  uploaded_by = wm.id
FROM streams s, workspace_members wm
WHERE a.stream_id = s.id
  AND wm.workspace_id = s.workspace_id
  AND wm.user_id = a.uploaded_by
  AND a.uploaded_by IS NOT NULL;

-- For attachments without a stream_id, use workspace_id directly
UPDATE attachments a SET
  uploaded_by = wm.id
FROM workspace_members wm
WHERE wm.workspace_id = a.workspace_id AND wm.user_id = a.uploaded_by
  AND a.uploaded_by IS NOT NULL
  AND a.uploaded_by LIKE 'usr_%';

-- =============================================================================
-- 10. Update emoji_usage: user_id → member_id
-- =============================================================================

ALTER TABLE emoji_usage ADD COLUMN member_id TEXT;

UPDATE emoji_usage eu SET
  member_id = wm.id
FROM workspace_members wm
WHERE wm.workspace_id = eu.workspace_id AND wm.user_id = eu.user_id;

-- Handle orphaned records
DELETE FROM emoji_usage WHERE member_id IS NULL;

ALTER TABLE emoji_usage ALTER COLUMN member_id SET NOT NULL;
ALTER TABLE emoji_usage DROP COLUMN user_id;

-- Recreate index with member_id
DROP INDEX IF EXISTS idx_emoji_usage_weights;
CREATE INDEX idx_emoji_usage_weights
  ON emoji_usage (workspace_id, member_id, interaction_type, created_at DESC)
  INCLUDE (shortcode, occurrence_count);

-- =============================================================================
-- 11. Update stream_persona_roster: added_by user_id → member_id
-- =============================================================================

-- added_by references the user who added the persona to the stream
UPDATE stream_persona_roster spr SET
  added_by = wm.id
FROM streams s, workspace_members wm
WHERE spr.stream_id = s.id
  AND wm.workspace_id = s.workspace_id
  AND wm.user_id = spr.added_by;

-- =============================================================================
-- 12. Update user_preference_overrides: (workspace_id, user_id) → member_id
-- =============================================================================

ALTER TABLE user_preference_overrides ADD COLUMN member_id TEXT;

UPDATE user_preference_overrides upo SET
  member_id = wm.id
FROM workspace_members wm
WHERE wm.workspace_id = upo.workspace_id AND wm.user_id = upo.user_id;

-- Handle orphaned records
DELETE FROM user_preference_overrides WHERE member_id IS NULL;

ALTER TABLE user_preference_overrides ALTER COLUMN member_id SET NOT NULL;

-- Rebuild PK: (workspace_id, user_id, key) → (member_id, key)
ALTER TABLE user_preference_overrides DROP CONSTRAINT user_preference_overrides_pkey;
ALTER TABLE user_preference_overrides ADD PRIMARY KEY (member_id, key);
ALTER TABLE user_preference_overrides DROP COLUMN workspace_id;
ALTER TABLE user_preference_overrides DROP COLUMN user_id;

-- Recreate index
DROP INDEX IF EXISTS idx_user_preference_overrides_user;
CREATE INDEX idx_user_preference_overrides_member ON user_preference_overrides (member_id);

-- =============================================================================
-- 13. Update ai_usage_records: user_id → member_id
-- =============================================================================

ALTER TABLE ai_usage_records ADD COLUMN member_id TEXT;

UPDATE ai_usage_records aur SET
  member_id = wm.id
FROM workspace_members wm
WHERE wm.workspace_id = aur.workspace_id AND wm.user_id = aur.user_id;

-- Drop old column and index, add new index
DROP INDEX IF EXISTS idx_ai_usage_user_created;
ALTER TABLE ai_usage_records DROP COLUMN user_id;
CREATE INDEX idx_ai_usage_member_created ON ai_usage_records(member_id, created_at DESC) WHERE member_id IS NOT NULL;

-- =============================================================================
-- 14. Update ai_user_quotas: user_id → member_id
-- =============================================================================

ALTER TABLE ai_user_quotas ADD COLUMN member_id TEXT;

UPDATE ai_user_quotas auq SET
  member_id = wm.id
FROM workspace_members wm
WHERE wm.workspace_id = auq.workspace_id AND wm.user_id = auq.user_id;

-- Handle orphaned records
DELETE FROM ai_user_quotas WHERE member_id IS NULL;

ALTER TABLE ai_user_quotas ALTER COLUMN member_id SET NOT NULL;

-- Rebuild unique constraint
ALTER TABLE ai_user_quotas DROP CONSTRAINT ai_user_quotas_workspace_id_user_id_key;
ALTER TABLE ai_user_quotas ADD CONSTRAINT ai_user_quotas_workspace_member UNIQUE (workspace_id, member_id);
ALTER TABLE ai_user_quotas DROP COLUMN user_id;

-- =============================================================================
-- 15. Update ai_alerts: user_id → member_id
-- =============================================================================

ALTER TABLE ai_alerts ADD COLUMN member_id TEXT;

UPDATE ai_alerts aa SET
  member_id = wm.id
FROM workspace_members wm
WHERE wm.workspace_id = aa.workspace_id AND wm.user_id = aa.user_id;

-- Rebuild unique index
DROP INDEX IF EXISTS idx_ai_alerts_unique;
ALTER TABLE ai_alerts DROP COLUMN user_id;
CREATE UNIQUE INDEX idx_ai_alerts_unique ON ai_alerts(workspace_id, COALESCE(member_id, ''), alert_type, period_start);
