-- Add a `version` integer column to scheduled_messages for optimistic
-- concurrency control on user saves. The previous CAS used `updated_at`,
-- which had to fight Postgres TIMESTAMPTZ microsecond precision vs JS Date
-- millisecond precision — every save 409'd until the comparison was
-- date_trunc'd. A monotonically increasing integer doesn't have that
-- problem and reads cleanly: "lock on version".
--
-- Default = 1 for both new rows and the back-fill. Every UPDATE that
-- represents a logical state change (user save, worker fire, mark sent /
-- failed, cancel, setQueueMessageId) increments the version. Fence bumps
-- (`edit_active_until`) intentionally do NOT bump the version — the fence
-- is metadata; bumping the version mid-edit would invalidate the user's
-- expectedVersion and 409 every save.

ALTER TABLE scheduled_messages
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
