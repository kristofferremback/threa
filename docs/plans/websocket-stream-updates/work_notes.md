# WebSocket Stream Update Propagation - Work Notes

**Started**: 2025-12-18
**Branch**: `websocket-stream-updates`
**Status**: Complete
**Request Doc**: `docs/requests/websocket-stream-updates.md`

## Session Log

### 2025-12-18 - Initial Planning & Implementation

**Context reviewed**:

- Read `apps/backend/src/repositories/outbox-repository.ts` - understood outbox event type pattern
- Read `apps/backend/src/services/stream-service.ts` - found `updateStream` and `archiveStream` don't publish events
- Read `apps/backend/src/lib/broadcast-listener.ts` - understood room routing pattern
- Read `apps/frontend/src/hooks/use-streams.ts` - understood cache update patterns

**Applicable invariants**: INV-4, INV-5, INV-6

**Completed**:

- [x] Phase 1: Added stream event types to outbox-repository.ts
- [x] Phase 2: Published outbox events from StreamService (create, update, archive)
- [x] Phase 3: Routed workspace-level events in broadcast-listener.ts
- [x] Phase 4: Created socket context for frontend
- [x] Phase 5: Created socket events hook
- [x] Phase 6: Integrated socket events at workspace layout level

**Key Decisions**:

### Workspace-Level Rooms

**Choice**: Add `ws:${workspaceId}` room for stream metadata events
**Rationale**: Stream updates need to reach ALL clients in a workspace (for sidebar updates), not just clients viewing the specific stream
**Alternatives considered**:

- Broadcast to all stream rooms - too complex, requires tracking all streams
- Client-side polling - defeats the purpose of real-time updates

### Event Scope

**Choice**: Include `stream:created`, `stream:updated`, `stream:archived`
**Rationale**: User requested full sync - any change in one tab should immediately appear in others
**Alternatives considered**:

- Only update/archive - less complete, user specifically requested create too

---

## Files Modified

### Backend

- `apps/backend/src/repositories/outbox-repository.ts` - Added `stream:created`, `stream:updated`, `stream:archived` event types
- `apps/backend/src/services/stream-service.ts` - Added OutboxRepository.insert calls in createScratchpad, createChannel, createThread, updateStream, archiveStream
- `apps/backend/src/lib/broadcast-listener.ts` - Route workspace-level events to `ws:${workspaceId}` room
- `apps/backend/src/socket.ts` - Added workspace room join validation, updated stream room pattern
- `apps/backend/src/server.ts` - Pass workspaceService to registerSocketHandlers

### Frontend

- `apps/frontend/src/contexts/socket-context.tsx` - New socket context with connection management
- `apps/frontend/src/contexts/index.ts` - Export SocketProvider, useSocket, useSocketConnected
- `apps/frontend/src/hooks/use-socket-events.ts` - Handle stream:created/updated/archived events
- `apps/frontend/src/hooks/index.ts` - Export useSocketEvents
- `apps/frontend/src/App.tsx` - Wrap app with SocketProvider
- `apps/frontend/src/pages/workspace-layout.tsx` - Call useSocketEvents(workspaceId)

---

## Blockers / Open Questions

None.
