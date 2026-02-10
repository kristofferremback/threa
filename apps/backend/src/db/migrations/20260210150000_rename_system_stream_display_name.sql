-- Rename system stream display name from "System" to "Threa" for consistency
-- with the user-facing persona name used everywhere else.
UPDATE streams SET display_name = 'Threa' WHERE type = 'system' AND display_name = 'System';
