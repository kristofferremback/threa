# Investigation: Outbox Sequence Gap — Permanent Event Loss Under Concurrency

## Symptom

CI E2E test `activity-feed.spec.ts:22` ("should show mention badge and activity feed when @mentioned by another user") fails intermittently — the mention badge never appears on User B's sidebar despite correct database state.

The test passes reliably in isolation but fails under CI's 6 parallel Playwright workers, where concurrent users create messages simultaneously.

## Root Cause

`BIGSERIAL` IDs are allocated at `INSERT` time but rows become visible at `COMMIT` time. Under concurrent transactions, out-of-order commits cause handlers to advance their cursor past still-invisible events, permanently skipping them.

Both `BroadcastHandler.processEvents` (`broadcast-handler.ts:111`) and `ActivityFeedHandler.processEvents` (`outbox-handler.ts:158`) return:

```typescript
return { status: "processed", newCursor: events[events.length - 1].id }
```

This always advances the cursor to the max batch ID, regardless of gaps in the visible sequence.

## The Bug in Detail

### How BIGSERIAL works

PostgreSQL's `BIGSERIAL` uses a sequence. When a transaction calls `INSERT INTO outbox`, it immediately allocates the next sequence value (e.g., 42). But the row with `id=42` is invisible to other transactions until the inserting transaction commits.

Two concurrent inserts can allocate IDs 42 and 43, but if 43 commits first:

- A `SELECT WHERE id > 41 ORDER BY id` sees `[43]` — row 42 is still invisible
- The handler processes event 43 and advances cursor to 43
- Transaction for 42 commits — but cursor is already past it
- Event 42 is permanently skipped

### Where this happens in the code

`OutboxRepository.fetchAfterId` (`lib/outbox/repository.ts:489-497`):

```typescript
async fetchAfterId(client: Querier, afterId: bigint, limit: number = 100): Promise<OutboxEvent[]> {
  const result = await client.query<OutboxRow>(sql`
    SELECT id, event_type, payload, created_at
    FROM outbox
    WHERE id > ${afterId.toString()}
    ORDER BY id
    LIMIT ${limit}
  `)
  return result.rows.map(mapRowToOutbox)
}
```

This query returns only committed, visible rows. If IDs 42 and 44 are visible but 43 is still in-flight, it returns `[42, 44]`.

The handler processes both and sets `newCursor = 44`. When 43 commits, no handler will ever see it — the cursor is at 44, and `WHERE id > 44` skips it.

`CursorLock.run` (`cursor-lock.ts:133-146`) advances the cursor on any "processed" result:

```typescript
case "processed": {
  if (result.newCursor <= cursor) {
    // sanity check — but doesn't detect gaps
    continueProcessing = false
    break
  }
  await this.updateCursor(result.newCursor, getNow())
  cursor = result.newCursor
  didWork = true
  break
}
```

The sanity check catches backward movement but not gaps from invisible rows.

## Why CI-Specific

6 parallel Playwright workers = 6 concurrent users creating messages across different workspaces. Each message creation runs through `withTransaction` which:

1. `BEGIN` — acquires sequence value for outbox INSERT
2. Inserts message, outbox events, runs NOTIFY
3. `COMMIT` — makes row visible

With 6 workers firing concurrently, the window between sequence allocation and commit is large enough for out-of-order visibility to occur regularly.

In local development with a single user, transactions rarely overlap. The bug is latent but real.

## Reproduction Scenario

Two concurrent PostgreSQL transactions demonstrating the visibility gap:

```
Time    Tx A (mention message)           Tx B (regular message)          Visible outbox rows
─────   ─────────────────────────────    ─────────────────────────────   ────────────────────
t0      BEGIN                            BEGIN
t1      INSERT outbox → id=42           INSERT outbox → id=43
        (message:created)                (message:created)
t2                                       COMMIT                          [..., 43]
t3      ← Tx A still open ─────────     ─────────────────────────────

        ActivityFeedHandler wakes up:
        fetchAfterId(cursor=41) → [43]
        processes 43 → advance cursor to 43

t4      COMMIT                                                           [..., 42, 43]
        ← Event 42 now visible, but cursor is at 43
        ← Event 42 will NEVER be processed by ActivityFeedHandler
```

## Pipeline Trace: How a Mention Gets Lost

Full trace showing where the gap causes permanent loss:

```
1. User A sends "@userB check this" in stream S
   └── MessageService.create() inside withTransaction:
       ├── INSERT message (id=msg_xxx)
       ├── INSERT outbox: message:created (id=42)      ← sequence allocated
       ├── INSERT outbox: stream:activity (id=43)
       └── NOTIFY outbox_events (deferred to COMMIT)

2. Meanwhile, User C sends a message in stream T
   └── withTransaction:
       ├── INSERT message
       ├── INSERT outbox: message:created (id=44)       ← sequence allocated
       └── COMMIT                                        ← id=44 visible now

3. NOTIFY fires, ActivityFeedHandler wakes (50ms debounce)
   └── fetchAfterId(cursor=41) → [44]                   ← id=42,43 still invisible
       ├── Processes event 44 (User C's message, different stream)
       └── Returns { newCursor: 44 }                     ← CURSOR JUMPS PAST 42,43

4. User A's transaction commits
   └── id=42 (message:created with @mention) now visible
       └── But ActivityFeedHandler cursor is at 44 — event 42 is SKIPPED

5. Activity record for User B's mention is never created
   └── No activity:created outbox event is ever written
       └── BroadcastHandler never emits activity:created to User B
           └── Mention badge never appears
```

The same gap pattern affects BroadcastHandler directly for `stream:activity` events — even if the activity record were created by some other path, the `stream:activity` outbox event (id=43) would be skipped by BroadcastHandler's own cursor for the same reason.

## Key Files

| File                                                   | Lines   | Role                                                 |
| ------------------------------------------------------ | ------- | ---------------------------------------------------- |
| `apps/backend/src/lib/outbox/broadcast-handler.ts`     | 96-121  | `processEvents` — advances cursor to max batch ID    |
| `apps/backend/src/features/activity/outbox-handler.ts` | 66-169  | `processEvents` — same cursor advancement pattern    |
| `apps/backend/src/lib/cursor-lock.ts`                  | 102-186 | `run` — exhaust loop that trusts handler's newCursor |
| `apps/backend/src/lib/outbox/repository.ts`            | 489-497 | `fetchAfterId` — query that misses uncommitted rows  |
| `tests/browser/activity-feed.spec.ts`                  | 22-125  | E2E test that exposes the bug under parallelism      |

## Possible Fixes

### 1. Gap-aware cursor advancement

Instead of advancing to `events[events.length - 1].id`, detect gaps and only advance to the contiguous prefix:

```typescript
// Advance cursor to the last ID in the contiguous sequence from cursor
let safeCursor = cursor
for (const event of events) {
  if (event.id === safeCursor + 1n) {
    safeCursor = event.id
  } else {
    break
  }
}
return { status: "processed", newCursor: safeCursor }
```

**Tradeoff:** If a gap persists (crashed transaction, very long transaction), the cursor stalls until the gap fills. Needs a timeout/skip mechanism for truly abandoned sequences.

### 2. Delay-based safety margin

Only process events older than N milliseconds, giving concurrent transactions time to commit:

```sql
SELECT ... FROM outbox
WHERE id > $cursor
  AND created_at < NOW() - INTERVAL '500 milliseconds'
ORDER BY id LIMIT $batch
```

**Tradeoff:** Adds 500ms latency to all real-time events. Doesn't fully guarantee safety — a very slow transaction could still exceed the margin.

### 3. Commit-order column

Add a `committed_at` column populated by a trigger on row visibility, or use `xmin`-based ordering. Process events in commit order rather than allocation order.

**Tradeoff:** Complex implementation. PostgreSQL doesn't natively expose commit timestamps without `track_commit_timestamp` (which has overhead).

### 4. Polling with high-water mark

Track a "safe" cursor that only advances when all IDs up to that point are visible. Use `SELECT MAX(id) FROM outbox` as an upper bound and check for gaps.

**Tradeoff:** Additional query per batch. Need to handle the case where gap detection stalls on an abandoned transaction.

## Related

- [broadcast-handler-event-loss.md](./broadcast-handler-event-loss.md) — Previous investigation into socket event loss from error-induced backoff (different root cause, same symptom area)
