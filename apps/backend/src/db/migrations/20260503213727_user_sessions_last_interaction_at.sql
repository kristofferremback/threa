-- Track when a device last had a real user interaction (pointer/key/touch).
-- A focused window can sit idle for hours; interaction is what proves the user
-- is actually there. Used by push routing to pick the device the user is on.
ALTER TABLE user_sessions ADD COLUMN last_interaction_at TIMESTAMPTZ;
