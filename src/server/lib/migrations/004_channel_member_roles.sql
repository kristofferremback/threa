-- Add role column to channel_members table if it doesn't exist
-- (This was supposed to be in 003 but was added after the migration ran)
ALTER TABLE channel_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';

