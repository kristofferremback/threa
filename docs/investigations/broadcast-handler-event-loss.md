# Investigation: Intermittent Socket Event Loss in BroadcastHandler

## User Report

Testing notification level changes (changed from "default"/mentions to "everything" in #general):

1. Browser 2: write in channel → Browser 1 gets activity indication, channel is blue (correct)
2. Browser 2: mention user in Browser 1 → Browser 1 gets activity indication, channel is red, shows 1 mention (correct)
3. Browser 2: write again → Browser 1 registers activity, indicator bumps to 3 (correct)
4. Browser 2: write again → **Nothing in Browser 1**
5. Browser 2: mention user from Browser 1 → **Nothing in Browser 1**, mentions still at 1, only 3 activities shown
6. Browser 1: navigate to activities → shows 5 activities but badge only shows 3
7. Browser 1: refresh → shows 5 activities, badge shows 5, channel shows 2 mentions

No code changes during testing (no HMR, no backend restarts).

## Key Observations

- Data is correct in the database — all 5 activity records exist (visible after API refetch on refresh)
- Only 3 of 5 `activity:created` socket events reached the frontend
- The `stream:activity` events (blue sidebar indicator) also stopped for messages 4-5
- Both `stream:activity` and `activity:created` go through the same BroadcastHandler

## Event Pipeline Trace

### Message creation flow

```
Message created (single transaction)
├── INSERT message → outbox: message:created (ID N)
├── INSERT outbox: stream:activity (ID N+1)
└── NOTIFY outbox_events (deferred until COMMIT)
```

### Activity creation flow (separate handler, separate cursor)

```
ActivityFeedHandler (50ms debounce, 200ms maxWait)
├── Processes message:created events
├── processMessageMentions() → INSERT activities (ON CONFLICT DO NOTHING)
├── processMessageNotifications() → INSERT activities (ON CONFLICT DO NOTHING)
└── withTransaction: INSERT outbox: activity:created for each activity
    └── NOTIFY outbox_events (deferred until COMMIT)
```

### Broadcast flow (separate handler, separate cursor)

```
BroadcastHandler (10ms debounce, 50ms maxWait)
├── Processes ALL outbox events sequentially
├── Stream-scoped (message:created, stream:activity): io.to(room).emit() — no DB query
├── Member-scoped (activity:created): MemberRepository.findById() → socket.emit() — DB query
├── Author-scoped (command:*, stream:read, etc.): MemberRepository.findById() → socket.emit() — DB query
└── On ANY error: CursorLock enters exponential backoff, ALL events blocked
```

## Registered Outbox Handlers

All share the same NOTIFY channel but have independent cursors:

| Handler                    | Listener ID           | Debounce | Purpose                                  |
| -------------------------- | --------------------- | -------- | ---------------------------------------- |
| BroadcastHandler           | `broadcast`           | 10/50ms  | Socket delivery for all events           |
| ActivityFeedHandler        | `activity-feed`       | 50/200ms | Creates activity records + outbox events |
| CompanionHandler           | `companion`           | —        | AI companion triggers                    |
| NamingHandler              | `naming`              | —        | Auto-naming streams                      |
| EmojiUsageHandler          | `emoji-usage`         | —        | Emoji tracking                           |
| EmbeddingHandler           | `embedding`           | —        | Semantic embeddings                      |
| BoundaryExtractionHandler  | `boundary-extraction` | —        | Conversation boundaries                  |
| MemoAccumulatorHandler     | `memo-accumulator`    | —        | GAM knowledge extraction                 |
| CommandHandler             | `command`             | —        | Slash command execution                  |
| MentionInvokeHandler       | `mention-invoke`      | —        | @mention AI invocation                   |
| AttachmentUploadedHandler  | `attachment-uploaded` | —        | Attachment processing                    |
| SystemMessageOutboxHandler | `system-message`      | —        | System message creation                  |

No shared listener IDs — each handler has exclusive cursor access.

## Root Cause Analysis

### Primary theory: BroadcastHandler backoff blocks all events

The BroadcastHandler processes events sequentially in batches. When it encounters a member-scoped event (like `activity:created`), it calls `MemberRepository.findById(pool, targetMemberId)` to resolve the target member's userId for socket lookup.

If this DB query fails (pool timeout, connection issue), the error propagates:

```
broadcastEvent() throws
  → processEvents() catch block returns { status: "error", newCursor: lastProcessedId }
    → CursorLock.recordError() → sets retry_after with exponential backoff
      → isReadyToProcess() returns false until backoff expires
        → ALL events blocked (including stream:activity which needs no DB query)
```

Backoff schedule: 1s → 2s → 4s → 8s → 16s (then DLQ).

**Why this matches the symptoms:**

- Messages 1-3 work because no errors have occurred yet
- A transient DB error on one `activity:created` event triggers backoff
- During backoff: messages 4-5's `stream:activity` events queue up but aren't processed
- After backoff expires (or after page refresh), correct data loads from API

### Secondary issue: ActivityFeedHandler retry loses outbox events

The ActivityFeedHandler creates activity records and outbox events in separate steps:

```typescript
// Step 1: Create activities (committed immediately via withClient)
const mentionActivities = await activityService.processMessageMentions(...)
const notificationActivities = await activityService.processMessageNotifications(...)

// Step 2: Create outbox events (separate transaction)
await withTransaction(pool, async (client) => {
  for (const activity of activities) {
    await OutboxRepository.insert(client, "activity:created", { ... })
  }
})
```

If step 2 fails (outbox transaction error), the activities exist in the DB but no outbox events are created. On retry:

1. `processMessageMentions()` → `insertBatch()` → `ON CONFLICT DO NOTHING` → returns `[]` (already exist)
2. `processMessageNotifications()` → `insertBatch()` → `ON CONFLICT DO NOTHING` → returns `[]` (already exist)
3. `activities = []` → `if (activities.length > 0)` → false → **no outbox events created**
4. Cursor advances past the event — outbox events permanently lost

The activity records are visible after refresh (API query), but no real-time socket events are ever sent.

### Alternative theory: Socket disconnection gap

Socket.io does not buffer events for disconnected clients. A brief WebSocket disconnection (even milliseconds) would cause all events emitted during that window to be permanently lost. On reconnection, `useReconnectBootstrap` invalidates queries and data refreshes from API.

Less likely because: user reported no code changes (no HMR/restarts), and the pattern of "works then stops" is more consistent with backoff than random disconnection.

## Architecture Notes

### NOTIFY mechanism

NOTIFY is called manually in `OutboxRepository.insert()`, not via a database trigger:

```typescript
// repository.ts
async insert(client, eventType, payload) {
  await client.query(`INSERT INTO outbox ...`)
  await client.query(`NOTIFY outbox_events`)  // Manual, inside transaction
}
```

PostgreSQL defers NOTIFY until transaction COMMIT and deduplicates multiple NOTIFYs to the same channel within a transaction.

### Debouncer behavior

`DebounceWithMaxWait` handles concurrent triggers:

- If executing, sets `pendingTrigger = true` (boolean, not counter — multiple triggers collapse)
- After execution completes, re-triggers if `pendingTrigger` was set
- This is correct: the re-trigger will exhaust all pending events via the cursor lock's exhaust loop

### CursorLock exhaust loop

When the lock is acquired, the processor is called repeatedly until it returns `no_events`:

```typescript
while (continueProcessing) {
  const result = await processor(cursor)
  // "processed" → advance cursor, continue loop
  // "no_events" → stop
  // "error" → record error, enter backoff, stop
}
```

This ensures all events are processed even if multiple NOTIFY signals are collapsed.

### Fallback polling

OutboxDispatcher polls every 2s as a safety net for missed NOTIFY signals. During CursorLock backoff, the poll triggers `handle()` → debouncer → `processEvents()` → `cursorLock.run()` → `isReadyToProcess()` returns false → no processing.

## Fix Applied (stream-settings branch)

### BroadcastHandler: per-event error isolation

Wrapped DB-querying sections in try-catch blocks so a failed member lookup skips that individual event instead of blocking the entire pipeline:

- Member-scoped events (`activity:created`): catch → log error → skip
- Author-scoped events (`command:*`, `stream:read`, etc.): catch → log error → skip
- `stream:member_added` direct emit: catch → log error → skip (room emit still happens)

**Tradeoff:** A failed member lookup now drops that single notification (user sees it on refresh). Previously, it blocked ALL events for 1-16 seconds. For broadcast, availability > guaranteed delivery.

### Not yet fixed: ActivityFeedHandler retry bug

The `ON CONFLICT DO NOTHING` + retry interaction needs a separate fix. Options:

1. Put activity creation and outbox inserts in the same transaction
2. Query for existing activities on retry if `insertBatch` returns empty
3. Use `ON CONFLICT DO UPDATE RETURNING` to always get the activity records back

## Verification Plan

1. **Check backend logs** for `"Failed to broadcast member-scoped event"` — confirms the backoff theory
2. **Reproduce with logging**: Send 5+ messages rapidly to a channel where another user has "everything" notification level
3. **Monitor outbox_listeners table**: Check if `broadcast` listener enters backoff state
   ```sql
   SELECT listener_id, last_processed_id, retry_count, retry_after, last_error, locked_until
   FROM outbox_listeners
   WHERE listener_id = 'broadcast';
   ```
4. **Frontend diagnostic**: Add temporary `console.debug` on `activity:created` and `stream:activity` socket handlers to confirm which events arrive
