# Complete Pool Exhaustion Fix - Three Bugs

**Date**: 2026-01-21
**Status**: ✅ All Fixed and Verified

---

## Summary

Found and fixed **three distinct bugs** causing connection pool exhaustion:

1. **Thundering Herd at Startup** - 15+ workers requesting connections simultaneously
2. **Duplicate Cron Schedules** - 22 schedules running instead of 1
3. **Excessive Queue Concurrency** - 100 handlers for 30 connection pool

All three were **production-critical** and would have caused immediate failures in production.

---

## Bug #1: Thundering Herd at Startup

### Problem

At server startup, 15+ workers (QueueManager with 10 concurrency + 9 OutboxListeners + ScheduleManager + CleanupWorker) all requested connections simultaneously from an **empty pool** with 2-second timeout.

**Timeline**:

```
06:19:32 - Server starts, pool has 0 connections
06:19:33 - All workers fail (1 second later!)
06:19:37 - Pool shows 30 total, 0 idle, 12 waiting
```

### Root Cause

- `connectionTimeoutMillis: 2000` too short for 15+ simultaneous connection requests
- Connections timeout before completing, but Client objects remain in pool's internal array
- Creates "phantom connections" - pool thinks it has 30 but database has 2

### Fix

```typescript
// Increased timeout
connectionTimeoutMillis: 10000 // Was: 2000

// Pre-warm pool before starting workers
logger.info("Pre-warming connection pool...")
await warmPool(pools.main, 15)
logger.info("Connection pool pre-warmed")
```

### Verification

✅ Server starts cleanly with no timeout errors
✅ Pool shows 15 connections immediately
✅ All workers start without failures

---

## Bug #2: Duplicate Cron Schedules

### Problem

Observed 18 memo batch check jobs executing simultaneously every 30 seconds:

```
[10:33:06] INFO: Dispatching memo batch process jobs (×18)
[10:33:16] INFO: Dispatching memo batch process jobs (×18)
```

### Root Cause - Three Compounding Bugs

**Bug 2a: API Misuse**

```typescript
// Method signature
async schedule(queueName, intervalSeconds, data, workspaceId = null)

// WRONG call (workspaceId passed as data!)
await jobQueue.schedule(JobQueues.MEMO_BATCH_CHECK, 30, { workspaceId: "system" })

// Correct call
await jobQueue.schedule(JobQueues.MEMO_BATCH_CHECK, 30, {}, "system")
```

**Bug 2b: SQL NULL Uniqueness**

```sql
-- This constraint allows multiple NULLs (NULL != NULL in SQL)
UNIQUE (queue_name, workspace_id)

-- Every restart created a new schedule with workspace_id=NULL
-- Accumulated to 22 schedules in worktree database!
```

**Bug 2c: Multiplicative Effect**

- 3 duplicate schedules × 6 ticks per schedule (60s lookahead) = 18 simultaneous jobs
- Each job found ~1 stream to process
- 18 batch process jobs dispatched simultaneously

### Fix

**Code fix**:

```typescript
await jobQueue.schedule(JobQueues.MEMO_BATCH_CHECK, 30, {}, "system")
//                                                     ^^  ^^^^^^^^
//                                                     empty payload
//                                                         4th param
```

**Database fix**:

```sql
ALTER TABLE cron_schedules
  ADD CONSTRAINT cron_schedules_queue_workspace_key
  UNIQUE NULLS NOT DISTINCT (queue_name, workspace_id);
```

**Cleanup**:

```sql
-- Deleted all duplicate schedules
DELETE FROM cron_schedules
WHERE queue_name = 'memo.batch-check' AND workspace_id IS NULL;
```

### Verification

✅ Only 1 schedule remains (workspace_id='system')
✅ Constraint prevents NULL duplicates
✅ No more simultaneous job bursts

---

## Bug #3: Excessive Queue Concurrency

### Problem

Connection timeout errors during runtime:

```
ERROR: timeout exceeded when trying to connect
  - queue-manager ticker failing
  - broadcast-handler failing
```

### Root Cause

**Configuration Math**:

```typescript
// Old config
maxConcurrency: 2        // 2 ticks in parallel
tokenBatchSize: 10       // 10 tokens per tick (default)
processingConcurrency: 5 // 5 messages per token (default)

Max concurrent handlers: 2 × 10 × 5 = 100 handlers
```

**Handler Behavior**:

```typescript
async processBatch() {
  return withTransaction(this.pool, async (client) => {
    // Holds 1 connection for ENTIRE duration
    const pending = await PendingItemRepository.findUnprocessed(...) // up to 50 items

    for (const item of messageItems) {
      await this.processMessage(client, item, ...) // AI calls (seconds/minutes!)
    }
    // Connection held the whole time!
  })
}
```

**Result**: 100 handlers × 1 connection each = **instant pool exhaustion** (pool has only 30!)

### Fix

**Conservative concurrency limits**:

```typescript
const jobQueue = new QueueManager({
  pool,
  maxConcurrency: 1, // Was: 2 (one tick at a time)
  tokenBatchSize: 3, // Was: 10 (max 3 workers)
  processingConcurrency: 3, // Was: 5 (max 3 messages per worker)
})

// Max concurrent handlers: 1 × 3 × 3 = 9
// Safe for 30 connection pool (25 available after overhead)
```

### Verification

✅ No timeout errors after 2+ minutes of monitoring
✅ Pool stable: 12 total, 9 idle, 0 waiting
✅ All queue processing working normally

---

## Architecture Issues Revealed

### Issue #1: Long-Held Transactions

**Problem**: Memo processing holds transactions during slow AI calls (seconds/minutes).

**Current**:

```typescript
withTransaction(pool, async (client) => {
  // ... database queries ...
  await classifierAI() // 1-5 seconds
  await memorizerAI() // 3-10 seconds
  // Connection held entire time!
})
```

**Should be**:

```typescript
// Fetch data
const data = await fetchData(pool)

// AI calls (no connection held)
const classification = await classifierAI(data)
const memo = await memorizerAI(data, classification)

// Save results
await withTransaction(pool, async (client) => {
  await saveMemo(client, memo)
})
```

This would reduce connection hold time from **10+ seconds to ~100ms**.

### Issue #2: No Backpressure

**Problem**: Queue system has no mechanism to detect pool exhaustion and slow down.

**Should have**:

- Monitor pool utilization
- Reduce concurrency when pool >80% utilized
- Increase concurrency when pool <50% utilized
- Dynamic adjustment based on actual resource usage

### Issue #3: Silent Accumulation

**Problem**: All three bugs were **silent** - no errors until catastrophic failure.

- Duplicate schedules: Accumulated to 22 over time
- Excessive concurrency: Only failed under load
- No metrics to detect gradual degradation

**Would have been caught by**:

- `cron_schedules_total{queue="X"}` - shows duplicates
- `pool_connections_waiting` - shows exhaustion
- `queue_handlers_concurrent` - shows excessive concurrency

---

## What Fixed It

| Bug                   | Band-Aid Fix                 | Proper Fix (TODO)                              |
| --------------------- | ---------------------------- | ---------------------------------------------- |
| Thundering Herd       | ✅ Pre-warm pool             | Validate architecture, ensure graceful scaling |
| Duplicate Schedules   | ✅ Fix API call + constraint | Use sentinel values instead of NULL            |
| Excessive Concurrency | ✅ Reduce limits             | Refactor to not hold connections during AI     |

---

## Production Readiness

### What Works Now ✅

- Server starts without timeout errors
- Handles idle-session timeout (60s) gracefully
- No connection leaks
- No crashes or unhandled errors
- Stable under moderate load

### What Doesn't Scale ⚠️

- Memo processing holds transactions during AI calls
- Fixed concurrency limits (not dynamic)
- No backpressure mechanism
- No metrics to detect degradation early

### Critical Next Steps 🔄

1. **Add metrics and alerting** - Detect issues before catastrophic failure
2. **Refactor memo processing** - Don't hold connections during AI calls
3. **Implement backpressure** - Dynamic concurrency based on pool utilization
4. **Load testing** - Verify behavior under realistic production load

---

## Lessons Learned

### 1. Configuration Without Understanding Is Dangerous

The QueueManager config looked reasonable:

```
maxConcurrency: 2, tokenBatchSize: 10, processingConcurrency: 5
```

But without understanding **handler behavior** (holding connections during slow AI calls), it caused instant pool exhaustion.

**Takeaway**: Document connection usage patterns for all handlers.

### 2. Logs Show Symptoms, Metrics Show Causes

- Logs showed "timeout errors" - symptom
- Had to investigate to find 100 concurrent handlers - cause
- Metrics would have shown `queue_handlers_concurrent=100` immediately

**Takeaway**: Production-grade observability is not optional.

### 3. Silent Bugs Compound Over Time

- 1st restart: 1 duplicate schedule → 1 job/30s
- 22nd restart: 22 duplicate schedules → 18+ jobs/30s
- No alerts, just gradual degradation

**Takeaway**: Monitor for duplicates, alert on unusual patterns.

### 4. Band-Aids Work Until They Don't

All three fixes are band-aids:

- Pre-warming works until worker count changes
- Reduced concurrency works until load increases
- Fixed constraint works but NULL handling is still fragile

**Takeaway**: Document technical debt, prioritize proper fixes.

---

## Related Documentation

- `THUNDERING-HERD-FIX.md` - Startup race condition details
- `DUPLICATE-SCHEDULES-FIX.md` - Cron schedule bug details
- `IDLE-SESSION-TIMEOUT-FIX.md` - PostgreSQL timeout handling
- `PRODUCTION-READY.md` - Verification tests and deployment checklist

---

## Next Session Focus

**Priority 1: Production-Grade Observability**

- Add Prometheus metrics for pool, queues, schedules
- Alert on pool exhaustion, duplicate schedules, excessive concurrency
- Dashboard showing real-time system health

**Priority 2: Architecture Fixes**

- Refactor memo processing to not hold transactions during AI
- Implement dynamic concurrency with backpressure
- Load test to find actual safe limits

**Priority 3: Technical Debt**

- Replace NULL workspace*id with sentinel value ('\_system*')
- Add connection usage documentation for all handlers
- Create queue configuration validation

---

**Bottom Line**: The system is now **stable but not scalable**. We've fixed the immediate crashes, but the architecture needs refactoring before production scale.
