# Distributed Cron Job System Design

## Current Queue System Analysis

### Core Design Principles

The queue system is built on **token-based work distribution** with these key properties:

1. **Workspace Sharding**: All work is scoped by `(queue_name, workspace_id)` pairs
2. **Token Coordination**: A token represents permission to process work for a specific pair
3. **Time-Based Locking**: Uses `leased_until` timestamps instead of complex distributed locks
4. **Atomic Acquisition**: Database guarantees only one worker gets a token via `LEFT JOIN` exclusion
5. **Fair Scheduling**: Orders by `next_process_after` (earliest messages first)
6. **Background Renewal**: Workers continuously renew token leases while processing

### Token Lifecycle (Current System)

```
1. Ticker polls every 100ms
2. batchLeaseTokens() finds available (queue, workspace) pairs:
   - Has pending messages (process_after <= NOW)
   - No active token (leased_until > NOW)
   - Orders by next_process_after ASC
3. Worker acquires token, processes messages in batch
4. Background timer renews token every 5s
5. When done, worker deletes token (releases pair)
```

### Key Query Pattern (Token Acquisition)

```sql
WITH available_pairs AS (
  -- Find pairs with pending work
  SELECT queue_name, workspace_id, MIN(process_after)
  FROM queue_messages
  WHERE process_after <= NOW()
    AND dlq_at IS NULL
    AND completed_at IS NULL
    AND (claimed_until IS NULL OR claimed_until < NOW())
  GROUP BY queue_name, workspace_id
),
pairs_without_tokens AS (
  -- Exclude pairs that already have active tokens
  SELECT ap.*
  FROM available_pairs ap
  LEFT JOIN queue_tokens qt ON
    qt.queue_name = ap.queue_name
    AND qt.workspace_id = ap.workspace_id
    AND qt.leased_until > NOW()
  WHERE qt.id IS NULL  -- Only pairs without tokens
)
INSERT INTO queue_tokens (...)
SELECT * FROM pairs_without_tokens
ORDER BY next_process_after ASC
LIMIT batch_size
```

**Atomicity**: The `LEFT JOIN` + `WHERE qt.id IS NULL` pattern ensures only one worker succeeds per pair. If two workers run this simultaneously, only one INSERT succeeds for each pair.

### Scaling Characteristics

**Strengths:**

- Horizontally scales by adding workers
- No single point of failure
- Work naturally load-balanced by workspace
- Database provides coordination (no Redis/Zookeeper needed)
- Efficient: Single query leases multiple tokens

**Current Limitations:**

- Token granularity is per-workspace (could split large workspaces with chunking)
- Polling overhead (100ms ticks × workers)
- No cron support (current schedule() runs on ALL nodes)

---

## Problem Statement: Distributed Cron

**Current behavior** (`QueueManager.schedule()`):

```typescript
schedule(queueName, intervalSeconds, data) {
  setInterval(async () => {
    await this.send(queueName, data)
  }, intervalSeconds * 1000)
}
```

**Issues:**

1. Runs on EVERY worker node
2. Creates duplicate messages (N workers = N messages per interval)
3. No coordination between nodes
4. Wastes database writes and queue processing

**Requirements:**

1. Only ONE worker sends the message per interval
2. If that worker crashes, another takes over
3. Scales to thousands of workspaces
4. Matches existing queue system design patterns
5. Minimal polling overhead

---

## Proposed Solution: Tick-Based Cron Tokens

Use the **same token pattern** that already works for message processing.

### Design Overview

Instead of tokens representing `(queue, workspace)` pairs, create tokens representing **cron schedule ticks**:

- **Schedule Definition**: What to run and when (stored in `cron_schedules` table)
- **Tick Token**: Permission to send THIS tick for THIS schedule (stored in `cron_ticks` table)
- **Tick Leasing**: Workers compete to acquire tick tokens, only one succeeds
- **Tick Execution**: Token holder sends the message, then deletes the tick token

This mirrors message processing:

- Message token → represents work unit
- Cron tick token → represents schedule execution unit

### Schema

```sql
-- Cron schedule definitions
-- One row per scheduled job (e.g., memo batch check every 30s)
CREATE TABLE cron_schedules (
    id TEXT PRIMARY KEY,                    -- cron_<ulid>
    queue_name TEXT NOT NULL,               -- Which queue to send to
    interval_seconds INTEGER NOT NULL,      -- How often to run
    payload JSONB NOT NULL,                 -- Data to send

    -- For workspace-specific crons (future)
    workspace_id TEXT,                      -- NULL = system-wide

    -- When the next tick needs to be created (NOT when to execute)
    -- Schedule Manager queries this to find schedules needing tick generation
    -- Updated after creating each tick: next_tick_needed_at = execute_at
    next_tick_needed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_cron_schedules_queue_workspace
    ON cron_schedules (queue_name, workspace_id)
    WHERE enabled = true;

-- Hot path: Find schedules that need tick generation soon
-- Only scans schedules whose next tick is due in the near future
-- Prevents scanning all 10,000+ schedules on every Schedule Manager run
CREATE INDEX idx_cron_schedules_next_tick
    ON cron_schedules (next_tick_needed_at)
    WHERE enabled = true;


-- Cron tick coordination table
-- Ephemeral tokens representing "right to execute this schedule now"
-- Pre-generated by Schedule Manager, executed by Message Ticker
CREATE TABLE cron_ticks (
    id TEXT PRIMARY KEY,                    -- tick_<ulid>
    schedule_id TEXT NOT NULL,              -- References cron_schedules.id
    queue_name TEXT NOT NULL,               -- Denormalized for efficiency
    payload JSONB NOT NULL,                 -- Denormalized for efficiency
    workspace_id TEXT,                      -- Denormalized for efficiency

    -- When this tick should execute (NOT when created)
    -- Schedule Manager pre-generates ticks with future execute_at
    -- Message Ticker finds ticks where execute_at <= NOW()
    execute_at TIMESTAMPTZ NOT NULL,

    -- Time-based lease (same pattern as queue_tokens)
    -- NULL = available, non-NULL = being executed
    leased_at TIMESTAMPTZ,
    leased_by TEXT,                         -- ticker_<ulid> identifier
    leased_until TIMESTAMPTZ,               -- Lock expires after this

    created_at TIMESTAMPTZ NOT NULL
);

-- Hot path: Find ticks ready for execution
-- Used by Message Ticker to find ticks that are due and available
CREATE INDEX idx_cron_ticks_execute
    ON cron_ticks (execute_at)
    WHERE leased_until IS NULL OR leased_until < NOW();

-- Find ticks by schedule (for deduplication check)
CREATE INDEX idx_cron_ticks_schedule
    ON cron_ticks (schedule_id, execute_at);

-- Cleanup expired ticks
CREATE INDEX idx_cron_ticks_cleanup
    ON cron_ticks (leased_until);
```

### Algorithm: Two-Phase Execution

The system separates **tick generation** (infrequent) from **tick execution** (frequent).

#### Phase 1: Schedule Manager (runs every 10s)

Pre-generates tick tokens for schedules whose next tick is needed soon:

```sql
-- Find schedules that need tick generation in the next 2 minutes
-- Uses next_tick_needed_at index - O(schedules needing work) not O(all schedules)
WITH schedules_needing_ticks AS (
  SELECT
    id AS schedule_id,
    queue_name,
    interval_seconds,
    payload,
    workspace_id,
    next_tick_needed_at AS execute_at
  FROM cron_schedules
  WHERE enabled = true
    AND next_tick_needed_at <= NOW() + interval '2 minutes'
  ORDER BY next_tick_needed_at ASC
  LIMIT 100  -- Process in batches
),
schedules_without_pending_ticks AS (
  -- Exclude schedules that already have a pending tick
  -- (Prevents duplicate tick generation if Schedule Manager runs frequently)
  SELECT snt.*
  FROM schedules_needing_ticks snt
  LEFT JOIN cron_ticks ct ON
    ct.schedule_id = snt.schedule_id
    AND ct.execute_at = snt.execute_at
  WHERE ct.id IS NULL
),
tick_ids AS (
  SELECT
    id,
    ROW_NUMBER() OVER () AS rn
  FROM unnest($1::text[]) AS id  -- Pre-generated tick IDs
)
INSERT INTO cron_ticks (
  id, schedule_id, queue_name, payload, workspace_id,
  execute_at,
  leased_at, leased_by, leased_until,
  created_at
)
SELECT
  t.id,
  sw.schedule_id,
  sw.queue_name,
  sw.payload,
  sw.workspace_id,
  sw.execute_at,
  NULL,  -- Not leased yet
  NULL,
  NULL,
  NOW()
FROM schedules_without_pending_ticks sw
JOIN tick_ids t ON t.rn = sw.rn
RETURNING *;

-- Update next_tick_needed_at for each schedule
UPDATE cron_schedules
SET next_tick_needed_at = execute_at + (interval_seconds || ' seconds')::interval
WHERE id = ANY($schedule_ids);
```

**Key Properties:**

- Only queries schedules with `next_tick_needed_at <= NOW() + 2 minutes`
- For 10,000 uniformly distributed schedules: ~42 schedules per run
- Creates ticks with future `execute_at` (e.g., 1 minute ahead)
- Batches to 100 schedules max per run

#### Phase 2: Message Ticker (existing, runs every 100ms)

Finds and executes ticks that are due:

```sql
-- Find ticks ready for execution (execute_at <= NOW, not leased)
-- This query is ADDED to the existing message ticker's onTick()
WITH available_ticks AS (
  SELECT
    id,
    schedule_id,
    queue_name,
    payload,
    workspace_id,
    execute_at
  FROM cron_ticks
  WHERE execute_at <= NOW()
    AND (leased_until IS NULL OR leased_until < NOW())
  ORDER BY execute_at ASC
  LIMIT 10
  FOR UPDATE SKIP LOCKED
)
UPDATE cron_ticks
SET
  leased_at = NOW(),
  leased_by = $1,  -- ticker_id
  leased_until = NOW() + $2  -- lockDuration
FROM available_ticks
WHERE cron_ticks.id = available_ticks.id
RETURNING
  cron_ticks.id,
  cron_ticks.schedule_id,
  cron_ticks.queue_name,
  cron_ticks.payload,
  cron_ticks.workspace_id,
  cron_ticks.execute_at;
```

**Key Properties:**

- Runs on existing 100ms ticker (no new polling infrastructure)
- Uses `FOR UPDATE SKIP LOCKED` (same as message leasing)
- Only one worker acquires each tick
- Most ticks: No work available → fast query (index-only scan)

### Tick Execution Flow

```typescript
class ScheduleManager {
  private ticker: Ticker

  constructor(private cronRepo: CronRepository, private config: ScheduleManagerConfig) {
    this.ticker = new Ticker({
      name: "schedule-manager",
      intervalMs: 10000,  // Run every 10 seconds
      maxConcurrency: 1
    })
  }

  start() {
    this.ticker.start(() => this.generateTicks())
  }

  private async generateTicks(): Promise<void> {
    // Find schedules needing tick generation in next 2 minutes
    const schedules = await this.cronRepo.findSchedulesNeedingTicks({
      lookaheadMinutes: 2,
      limit: 100
    })

    if (schedules.length === 0) return

    // Create tick tokens with future execute_at
    const ticks = await this.cronRepo.createTicks(schedules)

    logger.debug({ tickCount: ticks.length }, "Generated cron ticks")
  }
}

class QueueManager {
  // ... existing code ...

  async onTick(): Promise<void> {
    const now = new Date()

    // EXISTING: Lease message tokens
    const tokens = await this.tokenPoolRepo.batchLeaseTokens({...})
    if (tokens.length > 0) {
      const workers = tokens.map(token => this.processToken(token))
      await Promise.all(workers)
    }

    // NEW: Lease and execute cron ticks
    const ticks = await this.cronRepo.batchLeaseTicks({
      leasedBy: this.tickerId,
      leasedUntil: new Date(now.getTime() + this.lockDurationMs),
      limit: 10,
      now
    })

    if (ticks.length > 0) {
      const tickWorkers = ticks.map(tick => this.executeTick(tick))
      await Promise.all(tickWorkers)
    }
  }

  private async executeTick(tick: CronTick): Promise<void> {
    try {
      // Send message to queue (tick.payload already denormalized)
      await this.queueRepo.insert(this.pool, {
        id: queueId(),
        queueName: tick.queueName,
        workspaceId: tick.workspaceId,
        payload: tick.payload,
        processAfter: tick.executeAt,
        insertedAt: new Date()
      })

      logger.info({ scheduleId: tick.scheduleId, executeAt: tick.executeAt }, "Cron tick executed")
    } catch (err) {
      logger.error({ scheduleId: tick.scheduleId, err }, "Failed to execute cron tick")
    } finally {
      // Always delete tick (release schedule)
      await this.cronRepo.deleteTick({
        tickId: tick.id,
        leasedBy: this.tickerId
      })
    }
  }
}
```

**Key Insights:**

- ScheduleManager runs every 10s (600× less than message ticker)
- QueueManager's existing ticker handles both messages AND ticks
- No renewal needed: Tick execution is fast (insert + delete)
- Denormalized payload in cron_ticks avoids JOIN during execution

### Integration with QueueManager

Replace `schedule()` method:

```typescript
// OLD (runs on every node)
schedule(queueName, intervalSeconds, data) {
  setInterval(() => this.send(queueName, data), intervalSeconds * 1000)
}

// NEW (distributed via cron_schedules)
async schedule(queueName, intervalSeconds, data, workspaceId?) {
  await this.cronRepo.createSchedule({
    id: cronId(),
    queueName,
    intervalSeconds,
    payload: data,
    workspaceId,
    enabled: true
  })
}
```

**On startup**, QueueManager creates a `CronManager` instance that:

1. Polls for due schedules every 100ms (same as Ticker for messages)
2. Leases tick tokens atomically
3. Executes ticks (sends messages)
4. Deletes ticks (releases schedules)

### Workspace Scaling

**System-wide crons** (like memo batch check):

```typescript
schedule(JobQueues.MEMO_BATCH_CHECK, 30, { workspaceId: "system" })
```

→ Creates one schedule, Schedule Manager generates ticks every 30s

**Per-workspace crons** (future, e.g., workspace-specific reports):

```typescript
// For workspace A
schedule(JobQueues.WEEKLY_REPORT, 604800, { workspaceId: "ws_A" }, "ws_A")

// For workspace B
schedule(JobQueues.WEEKLY_REPORT, 604800, { workspaceId: "ws_B" }, "ws_B")
```

→ Creates separate schedules, Schedule Manager generates ticks for each workspace

**Scaling to 10,000 workspaces:**

With uniformly distributed intervals:

- 1,000 hourly crons (execute every hour)
- 5,000 daily crons (execute every day)
- 4,000 weekly crons (execute every week)

**Schedule Manager (every 10s):**

- Queries: `WHERE next_tick_needed_at <= NOW() + 2 minutes`
- Scans: ~42 schedules per run (not 10,000!)
  - 1,000 hourly: 33 in next 2 minutes
  - 5,000 daily: 7 in next 2 minutes
  - 4,000 weekly: 2 in next 2 minutes
- Creates ticks: 42 INSERT per run
- **Total query cost**: O(42) per 10s = 4.2 queries/sec

**Message Ticker (every 100ms):**

- Queries: `WHERE execute_at <= NOW()`
- Most ticks: 0 available → index-only scan (microseconds)
- Hot ticks: 1-10 available → quick lease + execute
- **Added overhead**: Negligible (same pattern as message leasing)

**Database ensures no duplicate execution:**

- Schedule Manager: Deduplication via `LEFT JOIN cron_ticks ... WHERE ct.id IS NULL`
- Message Ticker: Atomicity via `FOR UPDATE SKIP LOCKED`

### Comparison to Current System

| Aspect              | Message Processing               | Cron Execution                      |
| ------------------- | -------------------------------- | ----------------------------------- |
| **Work Unit**       | (queue, workspace) pair          | Schedule ID + execute_at            |
| **Token Table**     | queue_tokens                     | cron_ticks                          |
| **Creation**        | On-demand (when messages exist)  | Pre-generated (Schedule Manager)    |
| **Discovery**       | Message Ticker (100ms)           | Message Ticker (100ms)              |
| **Lease Duration**  | 10s (renewable)                  | 10s (no renewal)                    |
| **Token Lifecycle** | Lease → Renew → Process → Delete | Create → Lease → Execute → Delete   |
| **Fairness**        | By next_process_after            | By execute_at                       |
| **Coordination**    | LEFT JOIN exclusion              | LEFT JOIN + FOR UPDATE SKIP LOCKED  |
| **Atomicity**       | One token per pair               | One tick per (schedule, execute_at) |

### Migration Path

1. **Phase 1: Add cron tables**
   - Create migration with cron_schedules and cron_ticks
   - Add CronRepository with batchLeaseTicks(), deleteTick()

2. **Phase 2: Build CronManager**
   - Similar structure to QueueManager
   - Uses Ticker for polling
   - Integrates with existing QueueManager for message sending

3. **Phase 3: Replace schedule() calls**
   - Change server.ts to use new schedule() API
   - Old: `setInterval` on every node
   - New: Insert into cron_schedules

4. **Phase 4: Cleanup**
   - Remove old scheduledJobs Map from QueueManager
   - Remove setInterval-based schedule() method

### Performance Characteristics

**Schedule Manager (every 10s):**

- Query cost: O(schedules with next_tick_needed_at ≤ NOW + 2min)
- For 10,000 schedules: ~42 schedules per run
- Most runs: Create 0-50 ticks
- Database load: 1 SELECT + ~42 INSERTs + ~42 UPDATEs per 10s
- **Total**: ~8.5 queries/sec (compared to 36,000/hour for polling each schedule)

**Message Ticker (every 100ms):**

- Added query: `SELECT FROM cron_ticks WHERE execute_at <= NOW() LIMIT 10`
- Most ticks: 0 available → index-only scan (microseconds)
- Hot ticks: 1-10 available → lease + execute
- **Added overhead**: ~1ms per tick (negligible)

**Execution overhead:**

- Same as current system (sends message to queue)
- No additional hops or indirection
- Direct INSERT into queue_messages

**Database load (vs current setInterval approach):**

- **Old**: N workers × schedules × (1/interval) messages/sec
  - Example: 5 workers × 1 schedule × (1/30) = 0.17 msg/sec = **5× duplicate messages**
- **New**: 1 message per interval (deduplicated)
  - Example: 1 schedule × (1/30) = 0.033 msg/sec
- **Additional**: Tick CRUD operations (CREATE by Schedule Manager, DELETE by Message Ticker)
- **Net**: Significant reduction for multi-worker deployments

**Failure handling:**

- If Schedule Manager crashes: Other workers continue generating ticks (all run Schedule Manager)
- If worker crashes mid-tick: Tick lease expires, another worker picks it up
- If message send fails: Tick deleted, Schedule Manager creates new tick on next interval
- Same failure semantics as message processing

### Scaling Beyond 10,000 Schedules

If you need to scale to 100,000+ schedules, here are additional strategies:

**1. Shard Schedule Manager by hash:**

```typescript
// Each worker handles a subset of schedules
const myShardId = hash(workerId) % totalShards
WHERE enabled = true
  AND next_tick_needed_at <= NOW() + interval '2 minutes'
  AND hash(id) % $totalShards = $myShardId
```

- 10 workers × 10,000 schedules each = 100,000 total
- Each worker only scans its own shard

**2. Partition cron_schedules by time bucket:**

```sql
-- Partition by next_tick_needed_at (e.g., hourly buckets)
CREATE TABLE cron_schedules_2026_01_19_10 PARTITION OF cron_schedules
  FOR VALUES FROM ('2026-01-19 10:00:00') TO ('2026-01-19 11:00:00');
```

- Only scan partitions with upcoming work
- Old partitions can be archived

**3. Pre-aggregate into time buckets:**

```sql
-- Materialized view of schedules grouped by hour
CREATE MATERIALIZED VIEW cron_schedule_buckets AS
SELECT
  date_trunc('hour', next_tick_needed_at) AS bucket,
  COUNT(*) AS schedule_count,
  array_agg(id) AS schedule_ids
FROM cron_schedules
WHERE enabled = true
GROUP BY bucket;
```

- Schedule Manager: "Give me schedules in current bucket"
- Refresh view periodically

### Future Enhancements

1. **Tick history**: Keep executed ticks for observability
   - Move to `cron_ticks_history` instead of DELETE
   - Track execution latency (execute_at vs actual execution time)

2. **Backfill**: If schedule missed (e.g., all workers down), catch up
   - On startup, check for missed executions
   - Create ticks with past execute_at
   - Process immediately

3. **Jitter**: Add random offset to prevent thundering herd
   - Especially useful for daily/hourly crons
   - `execute_at = base_time + random(0, 60s)`

4. **Timezone support**: Schedule based on workspace timezone
   - Store `timezone` in cron_schedules
   - Calculate `next_tick_needed_at` in workspace timezone
   - Critical for daily reports, billing, etc.

5. **Cron expressions**: Support cron syntax instead of fixed intervals
   - Use cron parser library
   - Calculate next execution time dynamically
   - More flexible than fixed intervals

6. **Dynamic intervals**: Adjust interval based on workspace activity
   - E.g., more active workspaces get more frequent checks
   - Store `dynamic_interval` that adjusts based on metrics

7. **Priority scheduling**: Higher priority schedules execute first
   - Add `priority` column to cron_schedules
   - Order by `priority DESC, execute_at ASC`

---

## Implementation Checklist

### Database

- [ ] Create migration `028_cron_schedules.sql` with:
  - [ ] `cron_schedules` table with `next_tick_needed_at` column
  - [ ] `cron_ticks` table with denormalized payload
  - [ ] Indexes for efficient querying

### Repository

- [ ] Create `CronRepository` with:
  - [ ] `createSchedule()` - Insert into cron_schedules
  - [ ] `findSchedulesNeedingTicks()` - Query by next_tick_needed_at
  - [ ] `createTicks()` - Batch INSERT into cron_ticks
  - [ ] `batchLeaseTicks()` - Lease available ticks (mirrors `batchLeaseTokens()`)
  - [ ] `deleteTick()` - Delete after execution
  - [ ] `deleteExpiredTicks()` - Cleanup orphaned ticks
  - [ ] `updateNextTickNeeded()` - Update after tick creation

### Manager

- [ ] Create `ScheduleManager` class with:
  - [ ] Ticker-based polling (every 10s)
  - [ ] Tick generation (find schedules + create ticks)
  - [ ] Graceful shutdown
  - [ ] Configurable lookahead window (default 2 minutes)

- [ ] Update `QueueManager` class with:
  - [ ] Add tick execution to existing `onTick()` method
  - [ ] Execute tick (send message + delete tick)
  - [ ] Integrate ScheduleManager on startup

### API Changes

- [ ] Update `QueueManager.schedule()` to insert into cron_schedules
- [ ] Remove old `scheduledJobs` Map and setInterval logic
- [ ] Add graceful shutdown for ScheduleManager

### Testing

- [ ] Unit tests for `CronRepository.findSchedulesNeedingTicks()`
- [ ] Unit tests for `CronRepository.createTicks()` with deduplication
- [ ] Integration tests for ScheduleManager tick generation
- [ ] Integration tests for distributed tick execution
- [ ] Verify only one worker executes per interval
- [ ] Test lease expiration and failover
- [ ] Test Schedule Manager failure (other workers continue)
- [ ] Test scaling with 1,000+ schedules

### Observability

- [ ] Log schedule creation
- [ ] Log tick generation (count, schedules)
- [ ] Log tick execution with latency
- [ ] Metrics for tick generation rate
- [ ] Metrics for tick execution latency (execute_at vs actual)
- [ ] Alert on consistently missed ticks
- [ ] Dashboard showing active schedules and execution stats

---

## Alternatives Considered

### 1. Leader Election

- **Idea**: One leader worker runs all crons
- **Rejected**: Single point of failure, doesn't scale to many workspaces

### 2. Redis-based Locking

- **Idea**: Use Redis SET NX for distributed locks
- **Rejected**: Adds external dependency, we already use Postgres for coordination

### 3. Database Advisory Locks

- **Idea**: Use `pg_advisory_lock()` for schedule locking
- **Rejected**: Locks tied to connection, harder to reason about vs time-based leases

### 4. Message Deduplication

- **Idea**: Let all workers send, deduplicate in processing
- **Rejected**: Wastes database writes, doesn't solve the root problem

### 5. Sticky Assignment

- **Idea**: Hash schedule ID to worker, that worker owns it
- **Rejected**: Doesn't handle worker failures, manual rebalancing needed

**Chosen approach** (tick tokens) is consistent with existing system, uses proven patterns, and scales naturally.

---

## Conclusion

The distributed cron system uses the **exact same patterns** as the message processing system, with a two-phase approach for efficiency:

**Phase 1: Tick Generation (Schedule Manager, every 10s)**

1. **Index-driven discovery** (`next_tick_needed_at`)
2. **Batch creation** (pre-generate ticks for next 2 minutes)
3. **Deduplication** (LEFT JOIN to avoid duplicates)

**Phase 2: Tick Execution (Message Ticker, every 100ms)**

1. **Token-based coordination** (cron_ticks ≈ queue_tokens)
2. **Time-based leasing** (`leased_until`)
3. **Atomic acquisition** (`FOR UPDATE SKIP LOCKED`)
4. **Fair scheduling** (`ORDER BY execute_at`)
5. **Graceful cleanup** (delete tick when done)

**Key Advantages:**

- **Efficient**: Only queries schedules needing work (not all 10,000)
- **Scalable**: O(42) queries per 10s for 10,000 schedules
- **Consistent**: Uses proven patterns from message processing
- **Resilient**: Database coordination, no single point of failure
- **Simple**: No external dependencies (Redis, Zookeeper, etc.)

This design scales to thousands of workspaces and maintains the system's core principles: simple, database-coordinated, horizontally scalable.
