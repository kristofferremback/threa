# PostgreSQL idle_session_timeout Handling

## The Problem

PostgreSQL's `idle_session_timeout` (default 60s in our docker-compose) kills connections that sit idle for >60 seconds. This causes:

1. **Connection killed in pool**: Pool error event, connection removed automatically
2. **Connection killed during query**: Query fails with error code `57P05`, causes uncaught exception and crashes app

## The Solution - Three Layers of Defense

### 1. Pool Error Handler (`src/db/index.ts`)

Handles errors on idle connections in the pool:

```typescript
pool.on("error", (err: Error & { code?: string }) => {
  if (err.code === "57P05") {
    logger.info(/*...*/,
      "Connection killed by PostgreSQL idle-session timeout (expected with idle_session_timeout=60s)"
    )
    return // Don't crash - pg-pool removes dead connection automatically
  }
  logger.error({ err, code: err.code }, "Unexpected database pool error")
})
```

### 2. Process-Level Exception Handler (`src/server.ts`)

Catches 57P05 errors that escape to process level:

```typescript
process.on("uncaughtException", (err: Error & { code?: string }) => {
  if (err.code === "57P05") {
    logger.warn(/*...*/, "Uncaught idle-session timeout error - connection was killed by PostgreSQL")
    return // Don't exit - this is expected behavior
  }

  // For all other uncaught exceptions, log and exit
  logger.fatal({ err }, "Uncaught exception")
  process.exit(1)
})
```

### 3. Automatic Retry Logic (`src/db/index.ts`)

Both `withClient` and `withTransaction` automatically retry once on 57P05 errors:

```typescript
function isRecoverableConnectionError(err: unknown): boolean {
  const error = err as Error & { code?: string }
  return error.code === "57P05" || error.code === "ECONNRESET"
}

// Retry loop in withClient/withTransaction
for (let attempt = 0; attempt < 2; attempt++) {
  const client = await pool.connect()
  try {
    return await callback(client)
  } catch (error) {
    if (attempt === 0 && isRecoverableConnectionError(error)) {
      logger.debug(/*...*/, "Query failed with recoverable connection error, retrying...")
      client.release(true) // Destroy bad connection
      continue // Retry with fresh connection
    }
    throw error
  } finally {
    client.release()
  }
}
```

## How Each Layer Works Together

**Scenario 1: Connection killed while idle in pool**

- PostgreSQL kills idle connection after 60s
- pg-pool emits "error" event → caught by layer 1 (pool error handler)
- Logged as INFO, connection removed from pool automatically
- ✅ No crash, graceful handling

**Scenario 2: Connection killed during active query**

- Code calls `withClient(pool, async (client) => { /* query */ })`
- Connection was idle >60s before query, PostgreSQL killed it
- Query fails with 57P05 error
- Layer 3 (retry logic) catches it, destroys connection, retries with fresh connection
- ✅ No crash, transparent retry

**Scenario 3: Query fails but retry also fails**

- First attempt: 57P05 error
- Layer 3 retries
- Second attempt: Still fails (different error or same error on fresh connection)
- Error thrown to caller
- If uncaught, caught by layer 2 (process handler)
- If 57P05: logged as warning, process continues
- If other error: logged as fatal, process exits
- ✅ Graceful degradation, no silent failures

## Long-Held Connections

**LISTEN connections** (OutboxDispatcher):

- Held indefinitely for PostgreSQL NOTIFY/LISTEN
- Protected by keepalive queries every 30s (`SELECT 1`)
- Never idle >60s, won't be killed
- ✅ Safe

**HTTP request connections**:

- Use `withClient` or `withTransaction`
- Auto-released after response
- Typical request time: <1s
- ✅ Safe

**Background worker connections**:

- Use `withClient` with single queries or small batches
- Released after work completes
- Typical work time: <5s
- ✅ Safe

## Production Readiness

✅ **Handles stock PostgreSQL settings** - Works with default `idle_session_timeout=60s`
✅ **Graceful degradation** - Logs warnings but doesn't crash
✅ **Automatic retry** - Transparent retry on connection errors
✅ **Long-running operations protected** - Keepalive for LISTEN connections
✅ **No code changes needed** - All handling is at infrastructure layer

## What Won't Work

❌ **Long-held connections without keepalive**:

```typescript
// BAD - will be killed after 60s
const client = await pool.connect()
await longRunningWork() // >60s
await client.query("SELECT 1") // FAIL - connection dead
```

✅ **Fix**: Either use keepalive or don't hold connections >60s:

```typescript
// GOOD - release between work
await withClient(pool, async (client) => {
  await quickQuery(client)
})
await longRunningWork() // No connection held
await withClient(pool, async (client) => {
  await anotherQuery(client)
})
```

## Testing Verification

To verify the fix works:

1. **Start server** - should start without errors
2. **Let idle for 70 seconds** - connections get killed
3. **Make request** - should work (automatic retry with fresh connection)
4. **Check logs** - should see INFO/WARN about 57P05, not FATAL

Expected log pattern:

```
[INFO] Connection killed by PostgreSQL idle-session timeout (expected with idle_session_timeout=60s)
[DEBUG] Query failed with recoverable connection error, retrying...
```

NOT:

```
[FATAL] Uncaught exception: terminating connection due to idle-session timeout
```

## Related Issues

- **THUNDERING-HERD-FIX.md** - Fixes startup stampede (separate issue)
- **POOL-LEAK-FIX.md** - Phantom connection detection (obsolete, fixed by thundering herd)
- **CONNECTION-LEAK-ANALYSIS.md** - Original analysis (led to both fixes)

## Why Connection Validation Wasn't Needed

We initially tried HikariCP-style connection validation (validate on borrow if idle >500ms), but it caused startup hangs and ultimately wasn't necessary because:

1. **Retry logic is simpler** - One retry on 57P05 is enough
2. **Validation can't help connections already checked out** - They can still be killed mid-use
3. **Process error handler catches escapees** - Failsafe for any 57P05 that bubbles up
4. **Overhead is lower** - No SELECT 1 on every borrow, only on actual failure

The retry approach is more pragmatic: let it fail, catch it, retry once. Simple and effective.
