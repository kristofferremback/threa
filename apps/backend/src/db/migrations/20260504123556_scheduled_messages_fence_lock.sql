-- Replace the exclusive editor lock with a worker-fence + version CAS model.
--
-- Old model: `edit_lock_owner_id` + `edit_lock_expires_at` formed a mutual
-- exclusion primitive that blocked a second editor from claiming the row
-- while another tab/device held it. Stale locks (browser crash, killed app)
-- left users unable to edit their own scheduled message for up to the lock
-- TTL, even on the device that owned the lock.
--
-- New model: any number of editors can coexist. The fence
-- (`edit_active_until`) is bumped on open + heartbeat and only keeps the
-- *worker* from firing while a recent edit session exists. First save wins
-- via optimistic concurrency control on `updated_at` (already on the row) —
-- the second save's PATCH fails with 409 STALE_VERSION when the timestamp
-- it carries no longer matches the row.
--
-- The drop + rename is safe because the feature is unreleased — no row in
-- production carries data we'd lose. Per INV-17 we keep the original
-- migration intact; this is appended.

ALTER TABLE scheduled_messages DROP COLUMN IF EXISTS edit_lock_owner_id;
ALTER TABLE scheduled_messages RENAME COLUMN edit_lock_expires_at TO edit_active_until;
