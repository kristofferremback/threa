# WebSocket Stream Update Propagation

## Problem Statement

When a stream is renamed or archived, the change is reflected locally in the same browser tab but does not propagate to other browser tabs until a page refresh. This indicates that stream updates are not being broadcast via WebSocket.

## Current Behavior

1. User renames a scratchpad in Tab A
2. Tab A updates the stream via `PATCH /api/workspaces/:workspaceId/streams/:streamId`
3. Tab A's React Query cache is updated immediately (sidebar and header reflect the new name)
4. Tab B (same workspace, same or different stream) does NOT receive the update
5. Tab B only sees the change after a manual page refresh

## Expected Behavior

1. User renames a scratchpad in Tab A
2. Backend persists the change and emits a `stream_updated` event via outbox
3. All connected clients subscribed to that workspace receive the event via Socket.io
4. Frontend handles the event and updates React Query cache + IndexedDB

## Implementation Plan

### Backend

1. **Add stream update event type** to `EventType` enum:
   - `stream_updated` - emitted when stream metadata changes (displayName, description, etc.)
   - `stream_archived` - emitted when stream is archived

2. **Update StreamService.updateStream** to publish outbox event:

   ```typescript
   await publishOutboxEvent(client, workspaceId, {
     type: "stream_updated",
     payload: { stream: updatedStream },
   })
   ```

3. **Update StreamService.archiveStream** similarly

4. **Ensure outbox listener** broadcasts these events to all connected clients in the workspace

### Frontend

1. **Handle `stream_updated` event** in Socket.io connection:

   ```typescript
   socket.on("stream_updated", (data) => {
     queryClient.setQueryData(streamKeys.bootstrap(workspaceId, data.stream.id), (old) =>
       old ? { ...old, stream: data.stream } : old
     )
     queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old) => {
       if (!old?.streams) return old
       return {
         ...old,
         streams: old.streams.map((s) => (s.id === data.stream.id ? data.stream : s)),
       }
     })
     // Also update IndexedDB
     db.streams.put({ ...data.stream, _cachedAt: Date.now() })
   })
   ```

2. **Handle `stream_archived` event** similarly (remove from caches)

## Files to Modify

### Backend

- `apps/backend/src/lib/constants.ts` - Add event types
- `apps/backend/src/services/stream-service.ts` - Publish outbox events
- `apps/backend/src/services/outbox-listener.ts` - Handle new event types (if needed)

### Frontend

- `apps/frontend/src/contexts/socket-context.tsx` (or wherever socket handlers are)
- Need to verify where Socket.io event handlers are set up

## Acceptance Criteria

- [ ] Renaming a stream in one tab updates the name in all other tabs (same browser)
- [ ] Archiving a stream in one tab removes it from sidebar in all other tabs
- [ ] Changes persist correctly in IndexedDB for offline access
- [ ] Works across different browsers/devices when logged in as same user

## Notes

This is related to but separate from the draft scratchpad improvements. Draft scratchpads are only stored locally in IndexedDB and don't need WebSocket sync (they're converted to real streams on first message).
