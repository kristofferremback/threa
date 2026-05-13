-- Composite index supporting OutboxRepository.getEventStatuses, which filters
-- on (listener_id, outbox_event_id = ANY(...)). The single-column listener
-- index in 002 made the planner heap-scan every DLQ row for the listener
-- after the index lookup; the composite is an exact match.

CREATE INDEX idx_outbox_dead_letters_listener_event
    ON outbox_dead_letters (listener_id, outbox_event_id);
