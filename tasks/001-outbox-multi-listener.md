# 001: Multi-Listener Outbox Infrastructure

## Problem

Current outbox implementation has a single `processed_at` flag. Once an event is marked processed, it's considered done for ALL consumers. This creates several issues:

1. **No independent listener progress** - If we add a second consumer (e.g., companion AI), it shares state with the broadcast listener
2. **No retry isolation** - If one listener fails, we can't retry it independently
3. **Fire-and-forget side effects** - The closed PR #5 triggered companion responses outside the transaction with no durability guarantees

## Current State

### Schema (`002_core_schema.sql`)
```sql
CREATE TABLE outbox (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);
```

### Code (`outbox-listener.ts`)
- Single `OutboxListener` class
- NOTIFY/LISTEN + fallback polling
- Processes events in transaction, locks unprocessed rows with `FOR UPDATE SKIP LOCKED`
- Marks `processed_at` after broadcasting (single global flag, not per-listener)
- Only does Socket.io broadcasts

## Target State

Multiple independent listeners, each with:
- Own cursor (last processed event ID)
- Own retry state
- Independent failure/recovery
- Atomic processing per listener

## Design

### New Schema

```sql
-- Tracks each listener's progress through the outbox
CREATE TABLE outbox_listeners (
    listener_id TEXT PRIMARY KEY,           -- 'broadcast', 'companion', etc.
    last_processed_id BIGINT NOT NULL DEFAULT 0,
    last_processed_at TIMESTAMPTZ,

    -- Retry state for current batch
    retry_count INTEGER NOT NULL DEFAULT 0,
    retry_after TIMESTAMPTZ,
    last_error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for finding events after a cursor
CREATE INDEX idx_outbox_id ON outbox (id);

-- Dead letters for events that exceed max retries
CREATE TABLE outbox_dead_letters (
    id BIGSERIAL PRIMARY KEY,
    listener_id TEXT NOT NULL,
    outbox_event_id BIGINT NOT NULL,
    error TEXT,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Changes to Outbox Table

Remove `processed_at` column - it's now per-listener in `outbox_listeners`.

Add retention policy: events older than X days with all listeners past them get deleted.

### Architecture

```
                    outbox table
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   BroadcastListener  CompanionListener  (future listeners)
         │               │
         ▼               ▼
   outbox_listeners  outbox_listeners
   (cursor: 1000)    (cursor: 998)
```

Each listener:
1. Claims exclusive lock on its cursor row
2. Reads events from outbox (no lock needed, just a read)
3. Processes events
4. Updates cursor in same transaction
5. Commits (releases lock)
6. On failure: increments retry_count, sets retry_after with backoff

```sql
-- Step 1: Claim exclusive lock on this listener's cursor
SELECT last_processed_id, retry_count, retry_after
FROM outbox_listeners
WHERE listener_id = 'companion'
FOR UPDATE;

-- Step 2: Read events after cursor (no lock, just read)
SELECT id, event_type, payload, created_at
FROM outbox
WHERE id > $cursor
ORDER BY id
LIMIT 100;

-- Step 3-4: Process events, then update cursor
UPDATE outbox_listeners
SET last_processed_id = $new_cursor,
    last_processed_at = NOW(),
    retry_count = 0,
    retry_after = NULL,
    updated_at = NOW()
WHERE listener_id = 'companion';

-- Step 5: COMMIT releases the lock
```

### Base Listener Class

```typescript
interface OutboxListenerConfig {
  listenerId: string
  batchSize?: number
  maxRetries?: number
  baseBackoffMs?: number
}

abstract class BaseOutboxListener {
  abstract handleEvent(event: OutboxEvent): Promise<void>

  // Shared infrastructure:
  // - NOTIFY/LISTEN setup
  // - Cursor management
  // - Retry with exponential backoff
  // - Fallback polling
}
```

### Listener Implementations

**BroadcastListener** (existing behavior)
- Handles: all events
- Action: Socket.io broadcast to appropriate rooms
- Fast, rarely fails

**CompanionListener** (new, for Task 002)
- Handles: `message:created` where `authorType === 'user'`
- Action: Dispatch durable job to pg-boss for agent processing
- The actual AI work happens in the job, not the listener

## Implementation Steps

### Phase 1: Schema Migration

1. Create `outbox_listeners` table
2. Seed with `broadcast` listener, cursor = current max outbox ID
3. Keep `processed_at` temporarily for backward compatibility

### Phase 2: Refactor Listener

1. Create `BaseOutboxListener` abstract class
2. Create `BroadcastListener` extending base
3. Create `OutboxListenerRepository`:
   - `claimListener(client, listenerId)` - SELECT ... FOR UPDATE, returns cursor state
   - `updateCursor(client, listenerId, newCursor)` - Update after successful processing
   - `recordError(client, listenerId, error)` - Increment retry_count, set retry_after
4. Update `OutboxRepository`:
   - Add `fetchAfterId(client, afterId, limit)` - Read events after cursor (no lock)
5. Wire up in `server.ts`

### Phase 3: Cleanup

1. Remove `processed_at` from outbox table (migration)
2. Remove old `OutboxListener` class
3. Add retention job (delete events where all listeners have passed)

### Phase 4: Tests

1. Unit tests for cursor management
2. Unit tests for retry logic
3. Integration test: multiple listeners processing same events
4. Integration test: one listener fails, other continues

## Files to Create

- `apps/backend/src/db/migrations/003_outbox_listeners.sql`
- `apps/backend/src/lib/base-outbox-listener.ts`
- `apps/backend/src/lib/broadcast-listener.ts`
- `apps/backend/src/repositories/outbox-listener-repository.ts`

## Files to Modify

- `apps/backend/src/repositories/outbox-repository.ts` - Add cursor-based queries
- `apps/backend/src/server.ts` - Wire up new listener
- `apps/backend/src/repositories/index.ts` - Export new repository

## Files to Delete (Phase 3)

- `apps/backend/src/lib/outbox-listener.ts` - Replaced by new implementation

## Decisions

1. **Retention policy**: Deferred. Not enough data to matter yet, cleanup is trivial to add later.
2. **Max retries**: 5 attempts with increasing backoff.
3. **Backoff strategy**: Exponential with jitter. Base delay 1s, max delay 5min.
4. **Dead letter handling**: Move to `outbox_dead_letters` table with reference to original event + error context, then continue to next event.

## Out of Scope

- pg-boss integration (that's in Task 002)
- Actual companion AI logic (that's in Task 002)
- Horizontal scaling (multiple server instances) - FOR UPDATE SKIP LOCKED handles this
