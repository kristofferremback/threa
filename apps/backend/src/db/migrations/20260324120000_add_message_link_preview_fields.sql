-- Add target reference columns to link_previews for internal message link previews.
-- These are populated only when content_type = 'message_link'; NULL for external previews.
-- No foreign keys per INV-1.

ALTER TABLE link_previews ADD COLUMN target_workspace_id TEXT;
ALTER TABLE link_previews ADD COLUMN target_stream_id TEXT;
ALTER TABLE link_previews ADD COLUMN target_message_id TEXT;
