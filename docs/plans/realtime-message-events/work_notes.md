# Real-time Message Events - Work Notes

**Started**: 2025-12-18
**Branch**: main (direct)
**Status**: Complete
**Request Doc**: `docs/requests/realtime-message-events.md`

## Session Log

### 2025-12-18 - Investigation & Planning

**Context reviewed**:

- Read `apps/frontend/src/hooks/use-socket-events.ts` - only handles stream metadata events (create/update/archive), only joins workspace room
- Read `apps/frontend/src/hooks/use-events.ts` - provides `addEvent` and `updateEvent` callbacks that update React Query cache
- Read `apps/backend/src/lib/broadcast-listener.ts` - correctly routes message events to stream rooms
- Read `apps/backend/src/services/event-service.ts` - broadcasts `Message` objects, not `StreamEvent` objects
- Read `apps/backend/src/handlers/stream-handlers.ts` - bootstrap returns `StreamEvent[]`

**Applicable invariants**: INV-4 (Outbox for Real-time), INV-7 (Events + Projections)

**Root cause confirmed**:

1. Frontend never joins stream rooms (`ws:${workspaceId}:stream:${streamId}`)
2. Frontend has no listeners for message/reaction events
3. After sending, `invalidateQueries` refetches bootstrap instead of trusting WebSocket

**Key discovery - Data shape mismatch**:

- Bootstrap returns: `StreamEvent[]`
- Outbox broadcasts: `{ message: Message }` for `message:created`

Options:

1. **Backend change**: Broadcast `StreamEvent` instead of `Message`
2. **Frontend conversion**: Convert `Message` to `StreamEvent` on receive

Decision: Option 1 is cleaner. The `StreamEvent` is already created in the transaction (line 85-96 of event-service.ts). We should broadcast it instead of the message projection.

---

## Implementation Plan

### Phase 1: Backend - Broadcast StreamEvent instead of Message

Modify `EventService.createMessage()` to broadcast the `StreamEvent` instead of `Message`:

```typescript
// Current (line 110-114):
await OutboxRepository.insert(client, "message:created", {
  workspaceId: params.workspaceId,
  streamId: params.streamId,
  message, // <-- Message projection
})

// Target:
await OutboxRepository.insert(client, "message:created", {
  workspaceId: params.workspaceId,
  streamId: params.streamId,
  event: serializeBigInt(event), // <-- StreamEvent, serialized
})
```

This requires updating the outbox payload types in `outbox-repository.ts`.

### Phase 2: Frontend - Create useStreamSocket hook

New hook that:

1. Joins stream room on mount
2. Listens for message/reaction events
3. Updates React Query cache using `addEvent`/`updateEvent` from `useEvents`
4. Leaves stream room on unmount

### Phase 3: Frontend - Integrate hook in TimelineView

Call `useStreamSocket(workspaceId, streamId)` in TimelineView.

### Phase 4: Frontend - Remove invalidateQueries after send

In `MessageInput`, remove the query invalidation after successful send.

---

## Files to Modify

### Backend

- `apps/backend/src/repositories/outbox-repository.ts` - Update payload types to use StreamEvent
- `apps/backend/src/services/event-service.ts` - Broadcast StreamEvent instead of Message

### Frontend

- `apps/frontend/src/hooks/use-stream-socket.ts` - NEW: stream room subscription + event handlers
- `apps/frontend/src/hooks/index.ts` - Export new hook
- `apps/frontend/src/components/timeline/timeline-view.tsx` - Call useStreamSocket
- `apps/frontend/src/components/timeline/message-input.tsx` - Remove invalidateQueries

---

### 2025-12-18 - Implementation

**Completed**:

- [x] Phase 1: Backend - Updated outbox payload types to use `StreamEvent` instead of `Message`
  - Modified `outbox-repository.ts` to import `StreamEvent` instead of `Message`
  - Changed `MessageCreatedOutboxPayload` and `MessageEditedOutboxPayload` to use `event: StreamEvent`
  - Updated `EventService.createMessage()` and `editMessage()` to broadcast serialized `StreamEvent`

- [x] Phase 2: Frontend - Created `useStreamSocket` hook
  - New hook at `apps/frontend/src/hooks/use-stream-socket.ts`
  - Joins stream room on mount, leaves on unmount
  - Handles `message:created`, `message:edited`, `message:deleted`, `reaction:added`, `reaction:removed`
  - Updates React Query cache and IndexedDB
  - Dedupes events by ID to handle optimistic updates

- [x] Phase 3: Frontend - Integrated hook in TimelineView
  - Added `useStreamSocket` call before `useEvents` (subscribe-then-bootstrap pattern)
  - Enabled only for non-draft streams

- [x] Phase 4: Frontend - Removed invalidateQueries after send
  - Removed `queryClient.invalidateQueries` call from `MessageInput.onSuccess`
  - WebSocket now delivers the confirmed event instead of refetching

**Open Questions Resolved**:

1. ~~Should we also broadcast `StreamEvent` for message:edited?~~ Yes, done.
2. ~~How do we handle dedupe?~~ Handled in `useStreamSocket` by checking if event ID already exists in cache.

---

## Files Modified

### Backend

- `apps/backend/src/repositories/outbox-repository.ts` - Changed payload types to use StreamEvent
- `apps/backend/src/services/event-service.ts` - Broadcast StreamEvent instead of Message
- `apps/backend/src/lib/companion-listener.ts` - Updated to use new payload structure

### Frontend

- `apps/frontend/src/hooks/use-stream-socket.ts` - NEW: stream room subscription + event handlers
- `apps/frontend/src/hooks/index.ts` - Export new hook
- `apps/frontend/src/components/timeline/timeline-view.tsx` - Call useStreamSocket
- `apps/frontend/src/components/timeline/message-input.tsx` - Remove invalidateQueries

---

### 2025-12-18 - Bug Fix: Companion Listener

**Issue**: After changing payload from `{ message: Message }` to `{ event: StreamEvent }`, the companion listener broke because it was still accessing `message.authorType`.

**Fix**: Updated `companion-listener.ts` to use the new payload structure:

- `message.authorType` → `event.actorType`
- `message.authorId` → `event.actorId`
- `message.id` → `eventPayload.messageId` (from `event.payload`)

**Verified**: Naming listener unaffected (only uses `streamId` from payload).

---

## Next Steps

1. Test manually: send message in scratchpad, verify agent response appears in real-time
2. Test multiple tabs: open same stream in two tabs, verify messages sync
3. Consider adding tests for the useStreamSocket hook
