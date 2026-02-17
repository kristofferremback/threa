-- Generic uniqueness key for stream-level uniqueness semantics.
-- DMs use keys shaped as: dm:<member_a_id>:<member_b_id>

ALTER TABLE streams
ADD COLUMN IF NOT EXISTS uniqueness_key TEXT;

-- Ensure only generic uniqueness metadata remains on streams.
DROP INDEX IF EXISTS idx_streams_dm_member_pair_unique;
DROP INDEX IF EXISTS idx_streams_workspace_dm_member_a;
DROP INDEX IF EXISTS idx_streams_workspace_dm_member_b;

ALTER TABLE streams
  DROP COLUMN IF EXISTS dm_member_a_id,
  DROP COLUMN IF EXISTS dm_member_b_id;

-- Backfill DM uniqueness keys for existing valid one-to-one DMs.
WITH dm_members AS (
  SELECT
    s.id AS stream_id,
    MIN(sm.member_id) AS member_a_id,
    MAX(sm.member_id) AS member_b_id
  FROM streams s
  JOIN stream_members sm ON sm.stream_id = s.id
  WHERE s.type = 'dm'
  GROUP BY s.id
  HAVING COUNT(DISTINCT sm.member_id) = 2
),
dm_keys AS (
  SELECT
    stream_id,
    'dm:' || member_a_id || ':' || member_b_id AS uniqueness_key
  FROM dm_members
)
UPDATE streams s
SET
  uniqueness_key = dm_keys.uniqueness_key,
  updated_at = NOW()
FROM dm_keys
WHERE s.id = dm_keys.stream_id
  AND s.uniqueness_key IS DISTINCT FROM dm_keys.uniqueness_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_streams_workspace_uniqueness_key
ON streams (workspace_id, uniqueness_key)
WHERE uniqueness_key IS NOT NULL;
