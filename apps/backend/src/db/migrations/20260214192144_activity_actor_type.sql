-- Add actor_type to member_activity so the frontend can resolve persona vs member names
-- Backfill existing rows as 'member' (all pre-persona activity)

ALTER TABLE member_activity ADD COLUMN actor_type TEXT;
UPDATE member_activity SET actor_type = 'member' WHERE actor_type IS NULL;
ALTER TABLE member_activity ALTER COLUMN actor_type SET NOT NULL;
