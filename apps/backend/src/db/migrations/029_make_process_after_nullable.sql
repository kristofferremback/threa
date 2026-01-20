-- Make process_after nullable for completed and DLQ messages
-- Completed and DLQ messages don't need a retry time

ALTER TABLE queue_messages
  ALTER COLUMN process_after DROP NOT NULL;
