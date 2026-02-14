-- Backfill thread visibility from root stream.
-- Threads were previously hardcoded to 'private', but should inherit
-- from their root stream so threads in public channels are discoverable
-- by all workspace members during bootstrap.

UPDATE streams
SET visibility = root.visibility
FROM streams AS root
WHERE streams.type = 'thread'
  AND streams.root_stream_id IS NOT NULL
  AND root.id = streams.root_stream_id
  AND streams.visibility != root.visibility;
