-- Rename workspace_members to users and align identity column names.
-- Global users table was removed in 20260221230512_workspace_member_workos_identity.sql.

-- -----------------------------------------------------------------------------
-- 1) workspace_members -> users
-- -----------------------------------------------------------------------------
ALTER TABLE workspace_members RENAME TO users;

-- Constraint/index rename cleanup
ALTER TABLE users RENAME CONSTRAINT workspace_members_pkey TO users_pkey;
ALTER TABLE users RENAME CONSTRAINT workspace_members_id_key TO users_id_key;
ALTER TABLE users RENAME CONSTRAINT workspace_members_ws_slug_key TO users_workspace_slug_key;
ALTER TABLE users RENAME CONSTRAINT workspace_members_ws_workos_user_key TO users_workspace_workos_user_key;

ALTER INDEX idx_workspace_members_id RENAME TO idx_users_id;
ALTER INDEX idx_workspace_members_slug RENAME TO idx_users_workspace_slug;
ALTER INDEX idx_workspace_members_slug_trgm RENAME TO idx_users_slug_trgm;
ALTER INDEX idx_workspace_members_workos_user RENAME TO idx_users_workos_user;
ALTER INDEX idx_workspace_members_workspace_email RENAME TO idx_users_workspace_email;
ALTER INDEX idx_workspace_members_name_trgm RENAME TO idx_users_name_trgm;
ALTER INDEX idx_workspace_members_email_trgm RENAME TO idx_users_email_trgm;

-- -----------------------------------------------------------------------------
-- 2) Rename member_id columns that store workspace user identity
-- -----------------------------------------------------------------------------
ALTER TABLE avatar_uploads RENAME COLUMN member_id TO user_id;
ALTER INDEX idx_avatar_uploads_member RENAME TO idx_avatar_uploads_user;

ALTER TABLE member_activity RENAME TO user_activity;
ALTER TABLE user_activity RENAME COLUMN member_id TO user_id;
ALTER INDEX idx_member_activity_feed RENAME TO idx_user_activity_feed;
ALTER INDEX idx_member_activity_unread_by_stream RENAME TO idx_user_activity_unread_by_stream;
ALTER INDEX idx_member_activity_dedup RENAME TO idx_user_activity_dedup;

ALTER TABLE reactions RENAME COLUMN member_id TO user_id;

ALTER TABLE emoji_usage RENAME COLUMN member_id TO user_id;

ALTER TABLE user_preference_overrides RENAME COLUMN member_id TO user_id;
ALTER INDEX idx_user_preference_overrides_member RENAME TO idx_user_preference_overrides_user;

ALTER TABLE ai_usage_records RENAME COLUMN member_id TO user_id;
ALTER INDEX idx_ai_usage_member_created RENAME TO idx_ai_usage_user_created;

ALTER TABLE ai_user_quotas RENAME COLUMN member_id TO user_id;
ALTER TABLE ai_user_quotas RENAME CONSTRAINT ai_user_quotas_workspace_member TO ai_user_quotas_workspace_user;

ALTER TABLE ai_alerts RENAME COLUMN member_id TO user_id;
