# Naming Service Outbox Refactor - Work Notes

**Started**: 2025-12-18
**Branch**: main (direct)
**Status**: Complete
**Request**: `docs/requests/naming-service-outbox.md`

## Context

The naming service is currently coupled with the event service - `EventService` directly calls `streamNamingService.attemptAutoNaming()` (non-awaited) when a message is created. This violates separation of concerns and doesn't follow the outbox/listener pattern used by companion and broadcast features.

## Session Log

### 2025-12-18 - Initial Planning

**Context reviewed**:

- `docs/requests/naming-service-outbox.md` - requirements
- `apps/backend/src/lib/outbox-listener.ts` - base listener class with cursor tracking, retries, dead lettering
- `apps/backend/src/lib/companion-listener.ts` - example of listener dispatching pg-boss jobs
- `apps/backend/src/lib/broadcast-listener.ts` - example of simple listener emitting to Socket.io
- `apps/backend/src/workers/companion-worker.ts` - example of thin worker delegating to agent
- `apps/backend/src/services/stream-naming-service.ts` - existing naming logic (will remain here)
- `apps/backend/src/services/event-service.ts` - currently triggers naming, needs extraction
- `apps/backend/src/lib/job-queue.ts` - pg-boss wrapper, needs new queue name
- `apps/backend/src/server.ts` - wiring point for listeners/workers

**Applicable invariants**:

- INV-5 (Repository Pattern)
- INV-6 (Transactions in Services)
- INV-12 (Pass Dependencies, Not Configuration)
- INV-13 (Construct, Don't Assemble)

**Completed**:

- [x] Explore existing listener/worker patterns
- [x] Understand current naming flow
- [ ] Create implementation plan
- [ ] Get plan approval

**Next steps**:

1. Create implementation plan
2. Get approval from Kris
3. Implement

---

## Implementation Plan

### Step 1: Add Job Queue Entry

**File**: `apps/backend/src/lib/job-queue.ts`

Add `NAMING_GENERATE` to `JobQueues` and `NamingJobData` interface.

### Step 2: Create NamingListener

**File**: `apps/backend/src/lib/naming-listener.ts` (new)

- Filter for `message:created` events
- Check if stream needs auto-naming (first message check)
- Dispatch job to pg-boss queue
- Follows CompanionListener pattern

### Step 3: Create NamingWorker

**File**: `apps/backend/src/workers/naming-worker.ts` (new)

- Thin handler that receives job data
- Delegates to existing `StreamNamingService.attemptAutoNaming()`
- pg-boss handles retries on failure

### Step 4: Wire Up in Server

**File**: `apps/backend/src/server.ts`

- Create and register naming worker with job queue
- Create and start naming listener
- Add to shutdown sequence

### Step 5: Remove Naming Logic from EventService

**File**: `apps/backend/src/services/event-service.ts`

- Remove the non-awaited `streamNamingService.attemptAutoNaming()` call
- Clean up related import if no longer needed

### Step 6: Verify Tests

- Run existing tests to ensure no regressions
- Naming still works via new path

---

## Key Decisions

### Decision: Keep business logic in StreamNamingService

**Choice**: Worker only dispatches to existing service, doesn't contain naming logic
**Rationale**: Follows existing pattern (CompanionWorker delegates to CompanionAgent), keeps workers thin, makes naming logic reusable/testable independently
**Alternatives considered**: Moving naming logic into worker (rejected - violates thin worker pattern)

### Decision: Trigger on message:created (not new outbox event)

**Choice**: NamingListener listens for existing `message:created` events
**Rationale**: No need for new event type - we're just changing how we react to existing events
**Alternatives considered**: Creating `naming:requested` event type (rejected - over-engineering)

---

## Files Modified

- `apps/backend/src/lib/job-queue.ts` - Added `NAMING_GENERATE` queue and `NamingJobData` type
- `apps/backend/src/lib/naming-listener.ts` - New file: listens for `message:created`, dispatches naming jobs
- `apps/backend/src/workers/naming-worker.ts` - New file: thin handler delegating to `StreamNamingService`
- `apps/backend/src/server.ts` - Wired up naming listener and worker, added to shutdown sequence, removed `setStreamNamingService` call
- `apps/backend/src/services/event-service.ts` - Removed `streamNamingService` property, setter method, and non-awaited call

---

## Open Questions

None currently - pattern is clear from existing code.
