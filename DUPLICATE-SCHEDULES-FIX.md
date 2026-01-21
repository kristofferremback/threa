# Duplicate Cron Schedules Bug

**Date**: 2026-01-21
**Severity**: High (caused 18+ simultaneous job executions)
**Status**: ✅ Fixed

---

## The Problem

Observed behavior:

```
[10:33:06] INFO: Dispatching memo batch process jobs (18 times)
[10:33:16] INFO: Dispatching memo batch process jobs (18 times)
```

All 18 jobs executed at exactly the same millisecond, indicating a **thundering herd** in job scheduling.

---

## Root Cause Analysis

### Bug #1: Incorrect Method Call

**Method signature**:

```typescript
async schedule<T>(
  queueName: T,
  intervalSeconds: number,
  data: JobDataMap[T],
  workspaceId: string | null = null  // ← Default is NULL
): Promise<void>
```

**Incorrect call** (server.ts:352):

```typescript
await jobQueue.schedule(JobQueues.MEMO_BATCH_CHECK, 30, { workspaceId: "system" })
//                       ^^^^^^^^^^^^^^^^^^^^^^^^  ^^  ^^^^^^^^^^^^^^^^^^^^^^^
//                       arg1: queueName           arg2: intervalSeconds
//                                                    arg3: data (payload)
//                                                    arg4: workspaceId = NULL (default)
```

The object `{ workspaceId: "system" }` was passed as the **payload** (arg3), not as the **workspaceId** parameter (arg4).

**Result**: Every call created a schedule with `workspace_id = NULL`.

---

### Bug #2: SQL NULL Uniqueness

**Constraint**:

```sql
ALTER TABLE cron_schedules
  ADD CONSTRAINT cron_schedules_queue_workspace_key
  UNIQUE (queue_name, workspace_id);
```

**Problem**: In SQL, `NULL != NULL`, so the unique constraint allows **multiple NULL values**.

**Evidence**:

- Main database: 3 schedules with `workspace_id = NULL`
- Worktree database: **22 schedules** with `workspace_id = NULL`

Every server restart created a **new duplicate schedule**.

---

### Bug #3: Multiplicative Effect

With 3 duplicate schedules running every 30 seconds:

- ScheduleManager generates ticks with ±10% jitter (60s lookahead)
- Each schedule generates ~6 ticks in the lookahead window
- 3 schedules × 6 ticks = **18 simultaneous jobs**

Timeline:

1. Server starts, creates 4th duplicate schedule (now 4 total)
2. ScheduleManager runs every 10s, generates ticks for all 4 schedules
3. QueueManager discovers ticks, executes all at once
4. 18+ check jobs run simultaneously
5. Each finds ~1 stream to process
6. 18+ batch process jobs dispatched simultaneously

---

## The Fix

### Fix #1: Correct Method Call

```typescript
// Before
await jobQueue.schedule(JobQueues.MEMO_BATCH_CHECK, 30, { workspaceId: "system" })

// After
await jobQueue.schedule(JobQueues.MEMO_BATCH_CHECK, 30, {}, "system")
//                                                     ^^  ^^^^^^^^
//                                                     empty payload
//                                                         workspaceId arg
```

### Fix #2: Database Constraint

```sql
-- Drop old constraint
ALTER TABLE cron_schedules
  DROP CONSTRAINT cron_schedules_queue_workspace_key;

-- Recreate with NULLS NOT DISTINCT (PostgreSQL 15+)
ALTER TABLE cron_schedules
  ADD CONSTRAINT cron_schedules_queue_workspace_key
  UNIQUE NULLS NOT DISTINCT (queue_name, workspace_id);
```

The `NULLS NOT DISTINCT` clause treats **NULL values as equal**, preventing duplicates.

### Fix #3: Cleanup

```sql
-- Delete all duplicate schedules
DELETE FROM cron_schedules
WHERE queue_name = 'memo.batch-check' AND workspace_id IS NULL;
```

---

## Verification

**Before**:

```
queue_name        | workspace_id | count
------------------+--------------+-------
memo.batch-check  |              | 22
```

**After**:

```
queue_name        | workspace_id | count
------------------+--------------+-------
memo.batch-check  | system       | 1
```

**Logs after fix**:

- No more simultaneous job bursts
- One check job runs every 30 seconds
- Schedules no longer accumulate on restart

---

## Lessons Learned

### 1. Type Safety Limitations

TypeScript couldn't catch this bug because:

- `{ workspaceId: "system" }` is valid for `JobDataMap[MEMO_BATCH_CHECK]`
- Method parameters are positional, not named
- No type error when passing object to `data` parameter

**Prevention**: Use named parameters or builder pattern for complex APIs.

### 2. Database Constraints Are Not Foolproof

The unique constraint **appeared** to work but had a subtle SQL behavior:

- `UNIQUE (a, b)` allows multiple `(NULL, NULL)` rows
- This is standard SQL behavior (NULL != NULL)
- PostgreSQL 15+ added `NULLS NOT DISTINCT` to fix this

**Prevention**:

- Avoid NULL in unique constraints
- Use sentinel values (`'system'`, `'_global_'`) instead of NULL
- Or use partial unique indexes: `WHERE workspace_id IS NOT NULL`

### 3. Silent Accumulation

The bug was **silent** - no errors, just gradually degrading performance:

- Restart 1: 1 schedule → 1 job/30s
- Restart 2: 2 schedules → 2 jobs/30s
- Restart 22: 22 schedules → 18+ jobs/30s (thundering herd)

**Prevention**: Monitor for duplicate rows, alert on unusual patterns.

### 4. Metrics Would Have Caught This

What metrics would have detected this:

✅ **Cron schedule count**:

```
cron_schedules_total{queue="memo.batch-check"} = 22  # Should be 1!
```

✅ **Job execution concurrency**:

```
jobs_concurrent_executions{queue="memo.batch-check"} = 18  # Should be 1!
```

✅ **Tick generation rate**:

```
cron_ticks_generated_per_minute{queue="memo.batch-check"} = 36  # Should be 2!
```

**This is why we need production-grade instrumentation.**

---

## Impact

**Performance**:

- 18x unnecessary database queries
- 18x unnecessary job dispatches
- Wasted CPU, memory, connection pool slots

**Reliability**:

- Connection pool stress from simultaneous queries
- Potential race conditions in batch processing
- Confusing logs (why 18 jobs?)

**Accumulation**:

- Bug compounds over time (22 schedules in worktree DB)
- Each restart makes it worse
- No self-healing mechanism

---

## Related Issues

- **THUNDERING-HERD-FIX.md**: Startup connection pool exhaustion
- **IDLE-SESSION-TIMEOUT-FIX.md**: PostgreSQL idle timeout handling
- **PRODUCTION-READY.md**: Verification tests

All three issues discovered through **overnight monitoring** and **log analysis**. None would have been caught by unit tests.

---

## Next Steps

1. ✅ Fix committed and deployed
2. ✅ Migration created for constraint
3. ✅ Database cleaned up
4. 🔄 **Add metrics and alerting** (next focus)
5. 🔄 Monitor for 24 hours to verify fix

**Key takeaway**: Logs showed the symptom, but metrics would have shown the root cause immediately.
