# Thundering Herd Fix - January 21, 2026

## Executive Summary

**Problem:** Pool exhausts immediately (within 1 second) after hot reload with phantom connections.

**Root Cause:** Startup race condition where 15+ workers simultaneously request connections from an empty pool. The 2-second connection timeout is too short, causing connections to timeout during establishment. Pool creates Client objects anyway, resulting in 30 phantom connections.

**Fix:**

1. Increased `connectionTimeoutMillis` from 2 seconds to 10 seconds
2. Added `warmPool()` function to pre-create connections before workers start
3. Pre-warm 15 connections at startup to absorb initial worker demand

---

## Investigation - Second Pool Exhaustion

### Timeline from Overnight Run

**First exhaustion (from previous night):**

- 22:08:06 - Server started
- 22:38:06 - Pool exhausted after 30 minutes (phantom connections from slow leak)
- 22:38-06:17 - Pool remained deadlocked for 7+ hours

**Hot reload #1:**

- 06:17:27 - Server restarted
- **Instant failures** (within seconds)

**Hot reload #2:**

- 06:19:32 - Server restarted
- Pool starts: 0 total, 0 idle, 0 waiting
- 06:19:32 - All workers started (QueueManager, ScheduleManager, OutboxDispatcher, etc.)
- **06:19:33 - INSTANT FAILURES!** (1 second after start)
  - 2 QueueManager errors
  - All 9 outbox handlers fail
- **06:19:37 - Pool exhausted: 30 total, 0 idle, 12 waiting, 100% utilization**

### Key Finding: Instant Exhaustion

The pool went from **0 connections to 30 phantom connections in 5 seconds**! All 30 marked as "active" with 12 clients waiting.

This is completely different from the original 30-minute gradual leak!

---

## Root Cause Analysis

### The Thundering Herd

At startup, these workers all try to connect **simultaneously**:

1. **QueueManager** - maxConcurrency: 10 (can spawn up to 10 concurrent workers)
2. **ScheduleManager** - maxConcurrency: 1
3. **CleanupWorker** - maxConcurrency: 1
4. **OutboxDispatcher** - 9 handlers, each holding a connection
5. **OrphanSessionCleanup** - maxConcurrency: 1
6. **PoolMonitor** - trying to log stats
7. **Migrations** - already completed but used a connection
8. **LangGraph checkpointer** - setup queries

**Total: 15+ connection requests hitting an empty pool at the EXACT same instant!**

### Why This Causes Phantom Connections

1. All 15+ workers call `pool.connect()` simultaneously
2. Pool has 0 connections, needs to create them all
3. Pool creates Client objects immediately, adds them to `_clients` array
4. Each Client starts async connection to PostgreSQL
5. **Connection establishment takes time** (TCP handshake, auth, etc.)
6. `connectionTimeoutMillis: 2000` expires before connections establish
7. Timeout error thrown, but **Client objects remain in `_clients` array**
8. Pool thinks it has 30 connections, but they're all phantom (not actually connected)
9. All 30 marked as "active" (not idle), blocking new requests
10. Any new `pool.connect()` waits for a connection, but none are available → timeout

### Why 2 Seconds Is Too Short

PostgreSQL connection establishment involves:

- DNS lookup (if using hostname)
- TCP connection (3-way handshake)
- SSL negotiation (if enabled)
- Authentication
- `startup_message` exchange
- Initial query (search_path, etc.)

Under load (15+ simultaneous connections), this easily exceeds 2 seconds!

---

## The Fix

### 1. Increase Connection Timeout

**File:** `apps/backend/src/db/index.ts`

```typescript
const DEFAULT_POOL_CONFIG: Partial<PoolConfig> = {
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Was: 2000ms (too short!)
}
```

**Rationale:** 10 seconds gives enough time for connection establishment even under startup stampede.

### 2. Pool Pre-warming Function

**File:** `apps/backend/src/db/index.ts`

```typescript
export async function warmPool(pool: Pool, count: number = 10): Promise<void> {
  const clients: PoolClient[] = []

  try {
    // Acquire connections one at a time
    for (let i = 0; i < count; i++) {
      const client = await pool.connect()
      clients.push(client)
    }

    // Validate connections
    await Promise.all(clients.map((client) => client.query("SELECT 1")))
  } finally {
    // Release all back to pool
    clients.forEach((client) => client.release())
  }
}
```

**Rationale:** Pre-create connections BEFORE workers start, so they're ready when workers need them.

### 3. Call warmPool at Startup

**File:** `apps/backend/src/server.ts`

```typescript
await migrator.up()
logger.info("Database migrations complete")

// Pre-warm pool before starting workers
logger.info("Pre-warming connection pool...")
await warmPool(pools.main, 15) // Pre-create 15 connections
logger.info("Connection pool pre-warmed")

// Then start workers...
await jobQueue.start()
scheduleManager.start()
// etc.
```

**Rationale:** By creating 15 connections before workers start, we absorb the initial thundering herd without timeouts.

---

## Why This Works

**Before fix:**

1. Workers start → all request connections simultaneously
2. Pool creates 30 Client objects → all timeout during connection
3. 30 phantom connections, pool exhausted immediately

**After fix:**

1. warmPool creates 15 connections sequentially
2. All 15 establish successfully (no time pressure)
3. Workers start → 15 connections ready to use
4. No timeouts, no phantom connections!

---

## Testing the Fix

### Expected Behavior After Fix

**Startup sequence:**

```
[timestamp] INFO: Database migrations complete
[timestamp] INFO: Pre-warming connection pool...
[timestamp] INFO: Connection pool pre-warmed
[timestamp] INFO: QueueManager started
[timestamp] INFO: ScheduleManager started
[timestamp] INFO: CleanupWorker started
[timestamp] INFO: OutboxDispatcher started
[timestamp] INFO: Server started
```

**Pool stats after startup:**

- Total: 15-20 (pre-warmed + any additional)
- Idle: 5-10 (not all immediately used)
- Waiting: 0 (no contention!)
- No timeout errors in logs

### Verification Steps

1. **Restart server**

   ```bash
   # Kill current server
   pkill -f "bun --hot"

   # Start fresh
   cd apps/backend
   bun run dev
   ```

2. **Watch startup logs**

   ```bash
   # Should see "Pre-warming" and "pre-warmed" messages
   # Should NOT see "timeout exceeded" errors
   ```

3. **Check pool health immediately after startup**

   ```bash
   curl http://localhost:3001/debug/pool | jq '.publicStats'
   # Should show ~15 total, several idle, 0 waiting
   ```

4. **Check database connection count**

   ```sql
   SELECT count(*) FROM pg_stat_activity
   WHERE datname = 'threa_troubleshoot_pool_exhaustion';
   -- Should match pool.totalCount
   ```

5. **Run overnight again**
   - No immediate exhaustion at startup
   - Pool stays healthy for hours
   - If gradual leak still exists, we'll catch it separately

---

## Remaining Concerns

### 1. The Original 30-Minute Leak

The fix addresses the **startup thundering herd**, but the **original 30-minute gradual leak** is a separate issue:

- First exhaustion took 30 minutes (gradual climb from 77% → 100%)
- Phantom connection corruption (30 total but only 2 in database)
- This suggests a different root cause (connection not being released somewhere)

**Status:** Still needs investigation if it recurs after fixing startup herd.

### 2. Hot Reload Trigger

What triggers hot reloads? If it's file changes, that's fine. If it's crashes or errors, we need to investigate why the app is crashing.

**Check:** Review logs for why there were hot reloads at 06:17 and 06:19.

### 3. Pool Size Tuning

With 15+ workers needing connections at startup, is max: 30 enough?

**Current allocation:**

- 10 QueueManager workers (maxConcurrency: 10)
- 9 OutboxListener connections (held permanently)
- 1 ScheduleManager
- 1 CleanupWorker
- 1 OrphanSessionCleanup
- HTTP requests (variable)
- Migrations, checkpointer, etc. (transient)

**Total sustained:** ~22 connections
**Max:** 30
**Headroom:** 8 connections (27%)

This is tight! Consider increasing to max: 40 or reducing worker concurrency.

---

## Success Criteria

Fix is successful when:

- ✅ Server starts without "timeout exceeded" errors
- ✅ Pool stats after startup show ~15 total, several idle, 0 waiting
- ✅ Pool totalCount matches database connection count
- ✅ No phantom connections detected
- ✅ Server runs for 8+ hours without exhaustion
- ✅ Pool utilization stays < 70% during idle

---

## Next Steps

1. **Test the fix** - Restart server and verify startup is clean
2. **Monitor overnight** - Watch for the gradual leak (separate issue)
3. **Consider pool size increase** - 30 may be too small with 10+ workers
4. **Investigate hot reload triggers** - Why did app reload at 06:17 and 06:19?
5. **Add startup health check** - Verify pool is healthy before starting workers

---

## Related Issues

- **POOL-LEAK-FIX.md** - Documents the phantom connection detection added to PoolMonitor
- **CONNECTION-LEAK-ANALYSIS.md** - Original 30-minute gradual leak analysis

---

**Status:** Fix implemented, awaiting server restart to test.
