-- Backfill system streams for existing workspace members who don't have one.
-- Previously ran as application code on every startup; belongs here as a one-time migration.
-- No outbox events needed — migrations run before the server accepts connections.

-- 1. Create system streams for members missing one
INSERT INTO streams (id, workspace_id, type, display_name, visibility, companion_mode, created_by)
SELECT
  'stream_' || replace(gen_random_uuid()::text, '-', ''),
  wm.workspace_id,
  'system',
  'Threa',
  'private',
  'off',
  wm.id
FROM workspace_members wm
WHERE NOT EXISTS (
  SELECT 1 FROM streams s
  WHERE s.workspace_id = wm.workspace_id
    AND s.type = 'system'
    AND s.created_by = wm.id
)
ON CONFLICT (workspace_id, created_by) WHERE type = 'system'
DO NOTHING;

-- 2. Add stream membership for any system stream missing its owner
INSERT INTO stream_members (stream_id, member_id)
SELECT s.id, s.created_by
FROM streams s
WHERE s.type = 'system'
  AND NOT EXISTS (
    SELECT 1 FROM stream_members sm
    WHERE sm.stream_id = s.id AND sm.member_id = s.created_by
  )
ON CONFLICT (stream_id, member_id) DO NOTHING;
