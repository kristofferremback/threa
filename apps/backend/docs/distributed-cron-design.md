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

    created_at TIMESTAMPTZ NOT NULL,

    -- CRITICAL: Prevent duplicate tick generation
    -- Schedule Manager runs on multiple workers - this ensures only one tick per execution
    CONSTRAINT unique_schedule_execution UNIQUE (schedule_id, execute_at)
);

-- Hot path: Find ticks ready for execution
-- Used by Message Ticker to find ticks that are due and available
CREATE INDEX idx_cron_ticks_execute
    ON cron_ticks (execute_at)
    WHERE leased_until IS NULL OR leased_until < NOW();

-- Find ticks by schedule (for deduplication check)
CREATE INDEX idx_cron_ticks_schedule
    ON cron_ticks (schedule_id, execute_at);

-- Cleanup expired ticks (ticks that failed and lease expired)
CREATE INDEX idx_cron_ticks_cleanup
    ON cron_ticks (leased_until)
    WHERE leased_until IS NOT NULL;
```

### Execution Semantics

**At-Most-Once Delivery**

This system guarantees **at-most-once** execution per schedule interval:

- **Success case**: Tick is leased, message sent, tick deleted → exactly once
- **Failure case**: Tick lease expires, no retry attempted → zero times (skipped)

**Why at-most-once?**

1. **Simplicity**: No retry logic, no state tracking for retries
2. **Cron nature**: Scheduled jobs are periodic - a missed execution is acceptable
3. **Next execution**: If this tick fails, the next interval creates a new tick
4. **Idempotency burden**: At-least-once requires downstream handlers to be idempotent

**Tradeoffs:**

- ✅ **Pro**: Simple, fast, no retry complexity
- ✅ **Pro**: Failed ticks don't accumulate (cleanup is automatic)
- ✅ **Pro**: No thundering herd from retry storms
- ❌ **Con**: Critical jobs may be skipped if all execution attempts fail
- ❌ **Con**: No visibility into skipped executions (unless you track tick history)

**When this is acceptable:**

- Periodic health checks (next check in 30s)
- Aggregation jobs (next run catches up)
- Notification jobs (next interval will send)

**When this is NOT acceptable:**

- Billing jobs (must execute exactly once)
- Deadline-driven tasks (must execute before cutoff)
- SLA-critical operations (cannot tolerate misses)

For critical jobs, consider:

- External monitoring (alert if tick not executed within 2× interval)
- Explicit retry logic in the job handler itself
- Separate "critical job" queue with at-least-once semantics

### Failure Handling

**Tick execution failures:**

1. **Message send fails**: Tick is deleted, error logged, next interval creates new tick
2. **Worker crashes mid-execution**: Tick lease expires, another worker may pick it up if still within lease window
3. **Lease expires during execution**: Tick may be picked up by another worker (duplicate execution possible but rare)

**To prevent duplicate execution on lease expiry:**

- Set lease duration longer than typical execution time (default: 10s)
- Monitor execution times and alert if approaching lease duration
- If execution takes >10s, add renewal logic (similar to message token renewal)

**Orphaned ticks (lease expired, never completed):**

- Cleanup worker runs periodically (every 5 minutes)
- Deletes ticks where `leased_until < NOW() - interval '5 minutes'`
- These are "failed" executions - logged but not retried

**Schedule Manager failures:**

- Schedule Manager runs on all workers (no single point of failure)
- If one crashes, others continue generating ticks
- UNIQUE constraint prevents duplicate tick generation

### Algorithm: Two-Phase Execution

The system separates **tick generation** (infrequent) from **tick execution** (frequent).

#### Phase 1: Schedule Manager (runs every 10s)

Pre-generates tick tokens for schedules whose next tick is needed soon:

```sql
-- Find schedules that need tick generation in the configured lookahead window
-- Default lookahead: 30-60 seconds (configurable per deployment)
-- Uses next_tick_needed_at index - O(schedules needing work) not O(all schedules)
WITH schedules_needing_ticks AS (
  SELECT
    id AS schedule_id,
    queue_name,
    interval_seconds,
    payload,
    workspace_id,
    -- Add jitter: ±10% of interval to prevent thundering herd
    -- Example: 60s interval → jitter between -6s and +6s
    next_tick_needed_at +
      (random() * 0.2 - 0.1) * (interval_seconds || ' seconds')::interval AS execute_at
  FROM cron_schedules
  WHERE enabled = true
    AND next_tick_needed_at <= NOW() + $lookahead_interval  -- e.g., '60 seconds'
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

- Only queries schedules with `next_tick_needed_at <= NOW() + lookahead` (default: 60 seconds)
- For 10,000 uniformly distributed schedules: ~21-42 schedules per run (depends on lookahead)
- Creates ticks with future `execute_at` including jitter (e.g., 30-60s ahead ± 10%)
- Batches to 100 schedules max per run
- Jitter prevents thundering herd when many schedules share the same interval

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

### Cron Lifecycle Management

**Creating schedules:**

```typescript
await queueManager.schedule({
  queueName: JobQueues.MEMO_BATCH_CHECK,
  intervalSeconds: 30,
  payload: { workspaceId: "system" },
  workspaceId: null, // System-wide cron
})
```

**Disabling schedules (pause without deleting):**

```sql
UPDATE cron_schedules
SET enabled = false, updated_at = NOW()
WHERE id = $schedule_id;
```

- Schedule Manager skips disabled schedules (`WHERE enabled = true`)
- Existing pending ticks remain and will be executed
- To prevent pending ticks from executing, delete them:

```sql
DELETE FROM cron_ticks
WHERE schedule_id = $schedule_id
  AND leased_until IS NULL;  -- Don't delete currently executing ticks
```

**Re-enabling schedules:**

```sql
UPDATE cron_schedules
SET
  enabled = true,
  next_tick_needed_at = NOW(),  -- Generate tick immediately
  updated_at = NOW()
WHERE id = $schedule_id;
```

**Deleting schedules (permanent removal):**

```sql
-- 1. Delete pending ticks first (not currently executing)
DELETE FROM cron_ticks
WHERE schedule_id = $schedule_id
  AND leased_until IS NULL;

-- 2. Delete the schedule
DELETE FROM cron_schedules
WHERE id = $schedule_id;
```

**Handling orphaned ticks:**

When a schedule is deleted, ticks that are currently being executed (`leased_until IS NOT NULL`) remain until:

1. Execution completes → worker deletes tick normally
2. Lease expires → cleanup worker deletes orphaned tick

The cleanup worker handles this:

```sql
-- Run every 5 minutes
DELETE FROM cron_ticks
WHERE leased_until IS NOT NULL
  AND leased_until < NOW() - interval '5 minutes'
  AND schedule_id NOT IN (SELECT id FROM cron_schedules);
```

**Updating schedule intervals:**

```sql
UPDATE cron_schedules
SET
  interval_seconds = $new_interval,
  next_tick_needed_at = NOW(),  -- Regenerate tick with new interval
  updated_at = NOW()
WHERE id = $schedule_id;
```

Existing pending ticks use the old interval - they will execute, then new ticks use the new interval.

**Workspace cleanup (when workspace deleted):**

```sql
-- 1. Delete all workspace schedules
DELETE FROM cron_schedules
WHERE workspace_id = $workspace_id;

-- 2. Cleanup worker will delete orphaned ticks
-- (or delete immediately if you want)
DELETE FROM cron_ticks
WHERE workspace_id = $workspace_id
  AND leased_until IS NULL;
```

### Tick Execution Flow

```typescript
interface ScheduleManagerConfig {
  lookaheadSeconds: number  // Default: 60 (generate ticks for next minute)
  intervalMs: number         // Default: 10000 (run every 10 seconds)
  batchSize: number          // Default: 100 (max schedules per run)
}

class ScheduleManager {
  private ticker: Ticker

  constructor(
    private cronRepo: CronRepository,
    private config: ScheduleManagerConfig = {
      lookaheadSeconds: 60,
      intervalMs: 10000,
      batchSize: 100
    }
  ) {
    this.ticker = new Ticker({
      name: "schedule-manager",
      intervalMs: config.intervalMs,
      maxConcurrency: 1
    })
  }

  start() {
    this.ticker.start(() => this.generateTicks())
  }

  private async generateTicks(): Promise<void> {
    // Find schedules needing tick generation in configured lookahead window
    // Jitter is applied in the SQL query (±10% of interval)
    const schedules = await this.cronRepo.findSchedulesNeedingTicks({
      lookaheadSeconds: this.config.lookaheadSeconds,
      limit: this.config.batchSize
    })

    if (schedules.length === 0) return

    // Create tick tokens with future execute_at (including jitter)
    const ticks = await this.cronRepo.createTicks(schedules)

    logger.debug(
      { tickCount: ticks.length, lookaheadSeconds: this.config.lookaheadSeconds },
      "Generated cron ticks"
    )
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

### Cleanup Worker

A background worker runs periodically to clean up orphaned and expired ticks:

```typescript
class CleanupWorker {
  private ticker: Ticker

  constructor(
    private cronRepo: CronRepository,
    private config = { intervalMs: 300000 } // 5 minutes
  ) {
    this.ticker = new Ticker({
      name: "cron-cleanup",
      intervalMs: config.intervalMs,
      maxConcurrency: 1,
    })
  }

  start() {
    this.ticker.start(() => this.cleanup())
  }

  private async cleanup(): Promise<void> {
    // Delete ticks that failed and lease expired
    const expiredCount = await this.cronRepo.deleteExpiredTicks({
      expiredBefore: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
    })

    // Delete orphaned ticks (schedule was deleted)
    const orphanedCount = await this.cronRepo.deleteOrphanedTicks()

    if (expiredCount > 0 || orphanedCount > 0) {
      logger.info({ expiredCount, orphanedCount }, "Cleaned up cron ticks")
    }
  }
}
```

**Cleanup queries:**

```sql
-- Delete expired ticks (lease expired, not completed)
DELETE FROM cron_ticks
WHERE leased_until IS NOT NULL
  AND leased_until < $expired_before
RETURNING id;

-- Delete orphaned ticks (schedule deleted)
DELETE FROM cron_ticks
WHERE schedule_id NOT IN (SELECT id FROM cron_schedules)
RETURNING id;
```

### Monitoring and Alerting

**Key metrics to track:**

1. **Tick generation rate**: Ticks created per minute
2. **Tick execution latency**: `actual_execution_time - execute_at`
3. **Tick lease duration**: Time from lease to completion
4. **Orphaned tick count**: Ticks with expired leases
5. **Schedule coverage**: Ratio of executed ticks to scheduled ticks

**Critical alerts:**

```typescript
// Alert if tick execution latency exceeds lease duration
if (executionTime > leaseDuration * 0.9) {
  logger.warn(
    { tickId, executionTime, leaseDuration },
    "Tick execution approaching lease duration - risk of duplicate execution"
  )
}

// Alert if schedule not executed within 2× interval
if (lastExecutionTime && now - lastExecutionTime > interval * 2) {
  logger.error({ scheduleId, interval, lastExecutionTime }, "Schedule execution missed - investigate worker health")
}

// Alert if orphaned tick count grows
if (orphanedTickCount > 100) {
  logger.warn({ orphanedTickCount }, "High orphaned tick count - cleanup worker may be failing")
}
```

**Observability queries:**

```sql
-- Find schedules with no recent execution
SELECT
  s.id,
  s.queue_name,
  s.interval_seconds,
  MAX(t.created_at) AS last_tick_created,
  NOW() - MAX(t.created_at) AS time_since_last_tick
FROM cron_schedules s
LEFT JOIN cron_ticks t ON t.schedule_id = s.id
WHERE s.enabled = true
GROUP BY s.id
HAVING NOW() - MAX(t.created_at) > (s.interval_seconds * 2 || ' seconds')::interval;

-- Find slow tick executions
SELECT
  id,
  schedule_id,
  execute_at,
  leased_at,
  leased_until,
  EXTRACT(EPOCH FROM (leased_until - leased_at)) AS lease_duration_seconds,
  EXTRACT(EPOCH FROM (NOW() - leased_at)) AS execution_time_seconds
FROM cron_ticks
WHERE leased_at IS NOT NULL
  AND NOW() - leased_at > interval '10 seconds';
```

**Performance verification with EXPLAIN ANALYZE:**

```sql
-- Verify tick lease query uses index
EXPLAIN ANALYZE
SELECT id, schedule_id, queue_name, payload, workspace_id, execute_at
FROM cron_ticks
WHERE execute_at <= NOW()
  AND (leased_until IS NULL OR leased_until < NOW())
ORDER BY execute_at ASC
LIMIT 10
FOR UPDATE SKIP LOCKED;

-- Expected: Index Scan using idx_cron_ticks_execute
```

### Sharding Schedule Manager (for 100K+ schedules)

For extreme scale, shard Schedule Manager by schedule ID:

```typescript
interface ScheduleManagerConfig {
  lookaheadSeconds: number
  intervalMs: number
  batchSize: number
  // NEW: Sharding config
  shardCount: number // Total number of shards
  shardId: number // This worker's shard (0 to shardCount-1)
}

class ScheduleManager {
  private async generateTicks(): Promise<void> {
    const schedules = await this.cronRepo.findSchedulesNeedingTicks({
      lookaheadSeconds: this.config.lookaheadSeconds,
      limit: this.config.batchSize,
      // Only process schedules assigned to this shard
      shardCount: this.config.shardCount,
      shardId: this.config.shardId,
    })
    // ... rest of implementation
  }
}
```

**Sharding query:**

```sql
SELECT ...
FROM cron_schedules
WHERE enabled = true
  AND next_tick_needed_at <= NOW() + $lookahead_interval
  -- Stable hash-based sharding
  AND (hashtext(id)::bigint & 2147483647) % $shard_count = $shard_id
ORDER BY next_tick_needed_at ASC
LIMIT $batch_size;
```

**Benefits:**

- Each worker handles subset of schedules (e.g., 10 workers × 10K schedules = 100K total)
- Linear scaling: Add workers to handle more schedules
- No coordination needed: Hash-based assignment is deterministic

**Coordinator assignment:**

```typescript
// In server.ts startup
const workers = [
  { id: "worker-1", shardId: 0 },
  { id: "worker-2", shardId: 1 },
  // ...
]

const myWorker = workers.find((w) => w.id === process.env.WORKER_ID)
const scheduleManager = new ScheduleManager(cronRepo, {
  lookaheadSeconds: 60,
  intervalMs: 10000,
  batchSize: 100,
  shardCount: workers.length,
  shardId: myWorker.shardId,
})
```

### Future Enhancements

1. **Tick history**: Keep executed ticks for observability
   - Move to `cron_ticks_history` instead of DELETE
   - Track execution latency (execute_at vs actual execution time)

2. **Backfill**: If schedule missed (e.g., all workers down), catch up
   - On startup, check for missed executions
   - Create ticks with past execute_at
   - Process immediately

3. **Timezone support**: Schedule based on workspace timezone
   - Store `timezone` in cron_schedules
   - Calculate `next_tick_needed_at` in workspace timezone
   - Critical for daily reports, billing, etc.

4. **Cron expressions**: Support cron syntax instead of fixed intervals
   - Use cron parser library
   - Calculate next execution time dynamically
   - More flexible than fixed intervals

5. **Dynamic intervals**: Adjust interval based on workspace activity
   - E.g., more active workspaces get more frequent checks
   - Store `dynamic_interval` that adjusts based on metrics

6. **Priority scheduling**: Higher priority schedules execute first
   - Add `priority` column to cron_schedules
   - Order by `priority DESC, execute_at ASC`

---

## Implementation Checklist

### Database

- [ ] Create migration `028_cron_schedules.sql` with:
  - [ ] `cron_schedules` table with `next_tick_needed_at` column
  - [ ] `cron_ticks` table with denormalized payload
  - [ ] **CRITICAL**: Add UNIQUE constraint on `(schedule_id, execute_at)` to prevent duplicate ticks
  - [ ] Indexes for efficient querying (tick execution, schedule discovery, cleanup)
  - [ ] Verify index usage with EXPLAIN ANALYZE on tick lease query

### Repository

- [ ] Create `CronRepository` with:
  - [ ] `createSchedule()` - Insert into cron_schedules
  - [ ] `findSchedulesNeedingTicks()` - Query by next_tick_needed_at with configurable lookahead
  - [ ] `createTicks()` - Batch INSERT with jitter (±10% of interval)
  - [ ] `batchLeaseTicks()` - Lease available ticks (mirrors `batchLeaseTokens()`)
  - [ ] `deleteTick()` - Delete after execution
  - [ ] `deleteExpiredTicks()` - Cleanup ticks with expired leases
  - [ ] `deleteOrphanedTicks()` - Cleanup ticks whose schedule was deleted
  - [ ] `updateNextTickNeeded()` - Update after tick creation
  - [ ] `disableSchedule()` - Disable schedule without deleting
  - [ ] `deleteSchedule()` - Permanently remove schedule

### Manager

- [ ] Create `ScheduleManager` class with:
  - [ ] Ticker-based polling (configurable, default 10s)
  - [ ] Tick generation with jitter (find schedules + create ticks)
  - [ ] Configurable lookahead window (default 60 seconds, not 2 minutes)
  - [ ] Optional sharding support (for 100K+ schedules)
  - [ ] Graceful shutdown

- [ ] Create `CleanupWorker` class with:
  - [ ] Ticker-based polling (every 5 minutes)
  - [ ] Delete expired ticks (lease expired, not completed)
  - [ ] Delete orphaned ticks (schedule deleted)
  - [ ] Log cleanup counts

- [ ] Update `QueueManager` class with:
  - [ ] Add tick execution to existing `onTick()` method
  - [ ] Execute tick (send message + delete tick)
  - [ ] Monitor execution time vs lease duration
  - [ ] Alert if execution approaches lease duration (risk of duplicates)
  - [ ] Integrate ScheduleManager and CleanupWorker on startup

### API Changes

- [ ] Update `QueueManager.schedule()` to insert into cron_schedules
- [ ] Add `disableSchedule()` method for pausing schedules
- [ ] Add `deleteSchedule()` method for permanent removal
- [ ] Add `updateScheduleInterval()` method for changing intervals
- [ ] Remove old `scheduledJobs` Map and setInterval logic
- [ ] Add graceful shutdown for ScheduleManager and CleanupWorker

### Configuration

- [ ] Add `ScheduleManagerConfig` with:
  - [ ] `lookaheadSeconds` (default: 60)
  - [ ] `intervalMs` (default: 10000)
  - [ ] `batchSize` (default: 100)
  - [ ] Optional: `shardCount` and `shardId` for extreme scale
- [ ] Add `CleanupWorkerConfig` with:
  - [ ] `intervalMs` (default: 300000 = 5 minutes)
  - [ ] `expiredThresholdMs` (default: 300000 = 5 minutes)

### Testing

- [ ] Unit tests for `CronRepository.findSchedulesNeedingTicks()`
- [ ] Unit tests for `CronRepository.createTicks()` with:
  - [ ] Deduplication (UNIQUE constraint prevents duplicates)
  - [ ] Jitter applied (execute_at varies within ±10%)
- [ ] Integration tests for ScheduleManager tick generation
- [ ] Integration tests for distributed tick execution
- [ ] Verify only one worker executes per interval (no duplicates)
- [ ] Test lease expiration and failover
- [ ] Test Schedule Manager failure (other workers continue)
- [ ] Test cleanup worker (expired and orphaned ticks)
- [ ] Test schedule lifecycle (create, disable, enable, delete)
- [ ] Test scaling with 1,000+ schedules
- [ ] Verify EXPLAIN ANALYZE shows index usage
- [ ] Test at-most-once semantics (failed ticks not retried)

### Observability

- [ ] Log schedule creation/deletion/updates
- [ ] Log tick generation (count, schedules, lookahead)
- [ ] Log tick execution with latency (execute_at vs actual)
- [ ] Log cleanup operations (expired count, orphaned count)
- [ ] **Metrics**:
  - [ ] Tick generation rate (per minute)
  - [ ] Tick execution latency (actual - execute_at)
  - [ ] Tick lease duration (completion time)
  - [ ] Orphaned tick count
  - [ ] Schedule coverage (executed / scheduled)
- [ ] **Alerts**:
  - [ ] Tick execution approaching lease duration (>90%)
  - [ ] Schedule not executed within 2× interval
  - [ ] High orphaned tick count (>100)
  - [ ] Cleanup worker failing
- [ ] Dashboard queries:
  - [ ] Schedules with no recent execution
  - [ ] Slow tick executions
  - [ ] Failed tick rate
- [ ] EXPLAIN ANALYZE verification in CI/testing

### Documentation

- [ ] Document execution semantics (at-most-once, why, tradeoffs)
- [ ] Document failure handling (tick failures, lease expiry, orphaned ticks)
- [ ] Document cron lifecycle (create, disable, enable, delete, update interval)
- [ ] Document monitoring queries and alerts
- [ ] Document sharding approach for extreme scale

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

## Peer Review Recommendations Addressed

This design incorporates the following critical fixes and improvements:

### Critical Fixes

1. **✓ UNIQUE constraint on (schedule_id, execute_at)**: Prevents duplicate tick generation when multiple Schedule Managers run concurrently
2. **✓ Execution semantics documented**: At-most-once delivery explicitly stated with tradeoffs and rationale
3. **✓ Cleanup worker**: Periodic cleanup of expired and orphaned ticks
4. **✓ Jitter by default**: ±10% randomization of execute_at to prevent thundering herd
5. **✓ Configurable lookahead**: Default 60 seconds (not 2 minutes), adjustable per deployment

### Monitoring & Observability

6. **✓ Execution time monitoring**: Alert when tick execution approaches lease duration (>90%)
7. **✓ EXPLAIN ANALYZE verification**: Checklist includes index usage verification
8. **✓ Comprehensive metrics**: Generation rate, execution latency, orphaned count, schedule coverage
9. **✓ Critical alerts**: Missed executions, slow ticks, cleanup failures

### Scalability

10. **✓ Sharding Schedule Manager**: Hash-based sharding for 100K+ schedules with stable coordinator assignment

### Lifecycle Management

11. **✓ Cron removal documented**: Enable, disable, delete, update intervals with orphan cleanup
12. **✓ Orphaned tick handling**: Cleanup worker removes ticks whose schedules were deleted

### Recommendations NOT Implemented

- **Gradual rollout/feature flags**: Not needed pre-production (can add later)
- **Lease renewal for ticks**: Not needed - tick execution is fast (<1s typically), lease duration (10s) provides ample buffer

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
