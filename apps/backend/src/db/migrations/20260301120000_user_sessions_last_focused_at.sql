-- Track when a device last had Threa focused (not just open).
-- Used to distinguish "user tabbed away briefly" from "user walked away from computer."
ALTER TABLE user_sessions ADD COLUMN last_focused_at TIMESTAMPTZ;
