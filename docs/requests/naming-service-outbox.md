# Naming Service Outbox Refactor

## Problem Statement

The naming service is currently coupled with the event service. It should follow the same outbox/listener pattern used by other services (companion, broadcast) for better separation of concerns and consistency.

## Current State

The naming service logic is embedded in the event service, which violates the single responsibility principle.

## Proposed Solution

1. Create a dedicated `NamingListener` following the pattern of `CompanionListener` and `BroadcastListener`
2. Use the outbox table to trigger naming jobs
3. Register a pg-boss job handler for `naming.generate` (or similar)
4. Remove naming logic from the event service

## Implementation Steps

1. Create `apps/backend/src/listeners/naming-listener.ts`
2. Create `apps/backend/src/workers/naming-worker.ts` for the job handler
3. Publish outbox events for naming triggers (e.g., after first message in scratchpad)
4. Register the listener and worker in `server.ts`
5. Remove naming logic from event service

## Files to Modify

- `apps/backend/src/listeners/naming-listener.ts` (new)
- `apps/backend/src/workers/naming-worker.ts` (new)
- `apps/backend/src/server.ts` - Register new listener/worker
- `apps/backend/src/services/event-service.ts` - Remove naming logic

## Acceptance Criteria

- [ ] Naming service follows outbox/listener pattern
- [ ] Naming logic removed from event service
- [ ] Auto-generated stream names still work correctly
- [ ] Pattern is consistent with companion and broadcast listeners
