-- Add contact/identity fields to user profiles
-- Part of THR-27: workspace-scoped user profile handling

ALTER TABLE users ADD COLUMN IF NOT EXISTS pronouns TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_username TEXT;
