-- Enforce strict 1:1 DM semantics.
-- - Every DM stream must map to exactly one ordered member pair
-- - Member pair is unique within a workspace (one stream per pair)
-- - DM membership is immutable after creation and always exactly two members

CREATE TABLE IF NOT EXISTS dm_pairs (
  stream_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  member_a_id TEXT NOT NULL,
  member_b_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dm_pairs_workspace_member_pair_key UNIQUE (workspace_id, member_a_id, member_b_id),
  CONSTRAINT dm_pairs_distinct_members CHECK (member_a_id <> member_b_id),
  CONSTRAINT dm_pairs_sorted_members CHECK (member_a_id < member_b_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_pairs_workspace_member_a ON dm_pairs (workspace_id, member_a_id);
CREATE INDEX IF NOT EXISTS idx_dm_pairs_workspace_member_b ON dm_pairs (workspace_id, member_b_id);

-- Validate existing DM data before enforcing constraints.
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM (
    SELECT s.id
    FROM streams s
    LEFT JOIN stream_members sm ON sm.stream_id = s.id
    WHERE s.type = 'dm'
    GROUP BY s.id
    HAVING COUNT(DISTINCT sm.member_id) <> 2
  ) invalid_dms;

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Found % DM streams without exactly two members. Convert/fix them before applying DM constraints.',
      invalid_count;
  END IF;
END
$$;

-- Backfill canonical pairs for existing valid DMs.
INSERT INTO dm_pairs (stream_id, workspace_id, member_a_id, member_b_id)
SELECT
  s.id,
  s.workspace_id,
  LEAST(MIN(sm.member_id), MAX(sm.member_id)) AS member_a_id,
  GREATEST(MIN(sm.member_id), MAX(sm.member_id)) AS member_b_id
FROM streams s
JOIN stream_members sm ON sm.stream_id = s.id
WHERE s.type = 'dm'
GROUP BY s.id, s.workspace_id
HAVING COUNT(DISTINCT sm.member_id) = 2
ON CONFLICT (stream_id) DO NOTHING;

CREATE OR REPLACE FUNCTION validate_dm_pair_row()
RETURNS TRIGGER AS $$
DECLARE
  stream_workspace_id TEXT;
  stream_type TEXT;
BEGIN
  SELECT workspace_id, type
  INTO stream_workspace_id, stream_type
  FROM streams
  WHERE id = NEW.stream_id;

  IF stream_workspace_id IS NULL THEN
    RAISE EXCEPTION 'DM pair references unknown stream %', NEW.stream_id;
  END IF;

  IF stream_type <> 'dm' THEN
    RAISE EXCEPTION 'DM pair stream % must have type dm, got %', NEW.stream_id, stream_type;
  END IF;

  IF stream_workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'DM pair workspace mismatch for stream %', NEW.stream_id;
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_dm_pair_row ON dm_pairs;
CREATE TRIGGER trg_validate_dm_pair_row
BEFORE INSERT OR UPDATE ON dm_pairs
FOR EACH ROW
EXECUTE FUNCTION validate_dm_pair_row();

CREATE OR REPLACE FUNCTION enforce_dm_stream_has_pair()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.type <> 'dm' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dm_pairs dp
    WHERE dp.stream_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'DM stream % is missing canonical dm_pairs row', NEW.id;
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_streams_dm_requires_pair ON streams;
CREATE CONSTRAINT TRIGGER trg_streams_dm_requires_pair
AFTER INSERT OR UPDATE ON streams
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_dm_stream_has_pair();

CREATE OR REPLACE FUNCTION enforce_dm_pair_exact_membership()
RETURNS TRIGGER AS $$
DECLARE
  total_members INTEGER;
  pair_members INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO total_members
  FROM stream_members sm
  WHERE sm.stream_id = NEW.stream_id;

  SELECT COUNT(*)
  INTO pair_members
  FROM stream_members sm
  WHERE sm.stream_id = NEW.stream_id
    AND sm.member_id IN (NEW.member_a_id, NEW.member_b_id);

  IF total_members <> 2 OR pair_members <> 2 THEN
    RAISE EXCEPTION 'DM stream % must have exactly the two paired members', NEW.stream_id;
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dm_pairs_exact_membership ON dm_pairs;
CREATE CONSTRAINT TRIGGER trg_dm_pairs_exact_membership
AFTER INSERT OR UPDATE ON dm_pairs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_dm_pair_exact_membership();

CREATE OR REPLACE FUNCTION prevent_dm_member_mutation()
RETURNS TRIGGER AS $$
DECLARE
  target_stream_id TEXT;
  target_member_id TEXT;
  stream_type TEXT;
  pair_member_a_id TEXT;
  pair_member_b_id TEXT;
  existing_member_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_stream_id := OLD.stream_id;
    target_member_id := OLD.member_id;
  ELSE
    target_stream_id := NEW.stream_id;
    target_member_id := NEW.member_id;
  END IF;

  SELECT s.type
  INTO stream_type
  FROM streams s
  WHERE s.id = target_stream_id;

  IF stream_type <> 'dm' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'DM members are immutable';
  END IF;

  SELECT dp.member_a_id, dp.member_b_id
  INTO pair_member_a_id, pair_member_b_id
  FROM dm_pairs dp
  WHERE dp.stream_id = NEW.stream_id;

  -- Allow initial inserts before dm_pairs row exists in the same transaction.
  IF pair_member_a_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF target_member_id <> pair_member_a_id AND target_member_id <> pair_member_b_id THEN
    RAISE EXCEPTION 'DM streams can only include their two paired members';
  END IF;

  SELECT COUNT(*)
  INTO existing_member_count
  FROM stream_members sm
  WHERE sm.stream_id = NEW.stream_id;

  IF existing_member_count >= 2
     AND NOT EXISTS (
       SELECT 1
       FROM stream_members sm
       WHERE sm.stream_id = NEW.stream_id
         AND sm.member_id = target_member_id
     ) THEN
    RAISE EXCEPTION 'DM streams must have exactly two members';
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_dm_member_mutation ON stream_members;
CREATE TRIGGER trg_prevent_dm_member_mutation
BEFORE INSERT OR UPDATE OR DELETE ON stream_members
FOR EACH ROW
EXECUTE FUNCTION prevent_dm_member_mutation();
