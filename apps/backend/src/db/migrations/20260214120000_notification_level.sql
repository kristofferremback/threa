-- Replace boolean muted column with flexible notification_level column.
-- NULL means "use stream-type default". Non-null: everything, activity, mentions, muted.

ALTER TABLE stream_members ADD COLUMN notification_level TEXT;
UPDATE stream_members SET notification_level = 'muted' WHERE muted = TRUE;
ALTER TABLE stream_members DROP COLUMN muted;
