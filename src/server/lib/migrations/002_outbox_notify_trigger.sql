-- NOTIFY trigger for outbox table
-- This enables real-time processing of outbox events via PostgreSQL NOTIFY

CREATE OR REPLACE FUNCTION notify_outbox_event()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'outbox_event',
    json_build_object(
      'id', NEW.id,
      'event_type', NEW.event_type,
      'payload', NEW.payload,
      'created_at', NEW.created_at
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outbox_notify_trigger
AFTER INSERT ON outbox
FOR EACH ROW
EXECUTE FUNCTION notify_outbox_event();

