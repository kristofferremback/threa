-- Exclude saved_reminder activity rows from the non-reaction dedup index.
--
-- The original index deduped every non-reaction activity on
-- (user_id, message_id, activity_type, actor_id). Saved-reminder rows would
-- collapse under that rule — saving a message, firing a reminder, dismissing
-- it, re-saving, and re-firing would all map to the same (user, message,
-- 'saved_reminder', 'system') key and the second fire would silently UPSERT
-- the old row away.
--
-- Previously we worked around this by stuffing the saved_message ULID into
-- actor_id so each save-lifecycle minted a distinct key. That polluted the
-- actor_id contract (it's meant to be a user/bot/persona/system id, not an
-- arbitrary discriminator). The right fix is to make the dedup index not
-- apply to saved_reminder in the first place — the firing service already
-- guarantees single-delivery via `reminder_sent_at IS NULL`, so no DB-level
-- dedup is required.

DROP INDEX IF EXISTS idx_user_activity_dedup_non_reaction;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_activity_dedup_non_reaction
  ON user_activity (user_id, message_id, activity_type, actor_id)
  WHERE activity_type NOT IN ('reaction', 'saved_reminder');
