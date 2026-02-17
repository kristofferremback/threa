-- Keep DM membership identity immutable, but allow metadata updates
-- (e.g. last_read_event_id, notification_level, pinned).
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

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DM members are immutable';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.stream_id <> NEW.stream_id OR OLD.member_id <> NEW.member_id THEN
      RAISE EXCEPTION 'DM members are immutable';
    END IF;
    RETURN NEW;
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
