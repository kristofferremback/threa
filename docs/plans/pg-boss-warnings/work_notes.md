# pg-boss Warnings Fix - Work Notes

**Started**: 2025-12-19
**Branch**: pg-boss-warnings
**Status**: Complete

## Session Log

### 2025-12-19 - Initial Investigation & Fix

**Context reviewed**:

- Read `apps/backend/src/lib/job-queue.ts` - understood pg-boss initialization and job handling
- Explored worker implementations (`companion-worker.ts`, `naming-worker.ts`)
- Reviewed listeners that dispatch jobs (`companion-listener.ts`, `naming-listener.ts`)

**Applicable invariants**: INV-11 (No Silent Fallbacks)

**Problem identified**:
pg-boss was emitting warnings because:

1. No `error` event listener registered - pg-boss warns when errors occur with no handler
2. No mechanism for handling jobs that exhaust retries
3. Batch handler didn't log individual job failures with context

**Completed**:

- [x] Added `error` event listener before `boss.start()`
- [x] Implemented dead letter queue pattern for each job queue
- [x] Added warn-level logging on job failures (provides troubleshooting context)
- [x] Added error-level logging when jobs hit DLQ (triggers alerts)
- [x] Manual testing - server starts cleanly, no warnings

**Discovered**:

- pg-boss requires DLQ to exist before referencing it in `deadLetter` option (order matters)
- pg-boss's `executeSql` adapter must handle multi-statement queries: `pg` returns an array of results, each needing `{ rows: [...] }` format for pg-boss's `unwrapSQLResult` to work
- Outbox listener's "Listener not found" warning was misleading - `FOR UPDATE SKIP LOCKED` returns 0 rows when locked by another transaction, not just when missing. Removed spurious warning.

---

## Key Decisions

### Dead Letter Queue Naming Convention

**Choice**: `{queue}__dlq` suffix (e.g., `companion.respond__dlq`)
**Rationale**: Clear association with parent queue, double underscore prevents collision with legitimate queue names
**Alternatives considered**: Separate `dlq.{queue}` prefix - rejected because it groups by type rather than by domain

### Logging Hierarchy

**Choice**: `warn` on retry, `error` on DLQ
**Rationale**:

- Retries are expected (transient failures) - warn provides context without triggering alerts
- DLQ means all retries exhausted - systemic problem that needs attention
  **Alternatives considered**: `info` on retry - rejected because failures should be visible when troubleshooting

### Error Handler Placement

**Choice**: Register `error` listener before `boss.start()`
**Rationale**: Ensures no errors are missed during startup sequence
**Alternatives considered**: After start - rejected because startup errors would be unhandled

---

## Files Modified

- `apps/backend/src/lib/job-queue.ts` - Added error listener, DLQ setup, improved failure logging, fixed multi-statement query handling
- `apps/backend/src/repositories/outbox-listener-repository.ts` - Removed misleading warning for SKIP LOCKED case
