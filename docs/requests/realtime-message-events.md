# Real-time Message Events (Subscribe-Then-Bootstrap)

## Problem Statement

Agent responses in scratchpads don't appear until the page is refreshed. After sending a message, the frontend calls `invalidateQueries` to refetch the entire bootstrap - this is wasteful and still doesn't catch asynchronous agent responses.

## Current Behavior

1. User sends message → optimistic UI update
2. API returns → `invalidateQueries` triggers full bootstrap refetch
3. Agent responds asynchronously → backend broadcasts `message:created` to stream room
4. Frontend never receives it (not subscribed to stream room)
5. User must refresh to see agent response

## Root Cause

The frontend:

1. Never joins stream-specific rooms (`ws:${workspaceId}:stream:${streamId}`)
2. Has no listeners for message/reaction events
3. Relies on refetching instead of real-time updates

The backend is working correctly - it broadcasts events to the right rooms.

## Expected Behavior (Subscribe-Then-Bootstrap)

1. User enters stream view → join stream room via WebSocket
2. Fetch bootstrap (HTTP) → get initial state
3. Listen for message events → update cache incrementally
4. User sends message → optimistic update, NO refetch
5. Agent responds → WebSocket delivers `message:created` → cache updated automatically

This prevents the race condition where events could be missed between HTTP fetch and WebSocket subscription.

## Implementation Plan

### Phase 1: Stream Room Subscription Hook

Create `useStreamSocket` hook that:

- Joins stream room when stream view mounts
- Leaves stream room on unmount
- Listens for message/reaction events
- Updates React Query cache and IndexedDB when events arrive

```typescript
// hooks/use-stream-socket.ts
export function useStreamSocket(workspaceId: string, streamId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!socket || !workspaceId || !streamId) return

    // Subscribe FIRST
    socket.emit("join", `ws:${workspaceId}:stream:${streamId}`)

    // Then set up listeners
    socket.on("message:created", handleMessageCreated)
    socket.on("message:edited", handleMessageEdited)
    socket.on("message:deleted", handleMessageDeleted)
    socket.on("reaction:added", handleReactionAdded)
    socket.on("reaction:removed", handleReactionRemoved)

    return () => {
      socket.emit("leave", `ws:${workspaceId}:stream:${streamId}`)
      socket.off("message:created")
      // ... etc
    }
  }, [socket, workspaceId, streamId])
}
```

### Phase 2: Event Handlers

Each handler updates:

1. React Query cache (stream bootstrap)
2. IndexedDB (for offline)

```typescript
const handleMessageCreated = (payload: MessageEventPayload) => {
  // Add event to bootstrap cache
  queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old) => {
    if (!old) return old
    // Dedupe by event ID (might be our own optimistic event)
    if (old.events.some((e) => e.id === payload.event.id)) return old
    return {
      ...old,
      events: [...old.events, payload.event],
      latestSequence: payload.event.sequence,
    }
  })
  // Cache to IndexedDB
  db.events.put({ ...payload.event, _cachedAt: Date.now() })
}
```

### Phase 3: Remove Refetch After Send

In `MessageInput`, remove:

```typescript
queryClient.invalidateQueries({
  queryKey: streamKeys.bootstrap(workspaceId, streamId),
})
```

The WebSocket will deliver the confirmed event.

### Phase 4: Integrate Hook

Call `useStreamSocket` in TimelineView or StreamPage.

## Files to Modify

### Frontend

- `apps/frontend/src/hooks/use-stream-socket.ts` - NEW: stream room subscription + event handlers
- `apps/frontend/src/hooks/index.ts` - Export new hook
- `apps/frontend/src/components/timeline/timeline-view.tsx` - Call useStreamSocket
- `apps/frontend/src/components/timeline/message-input.tsx` - Remove invalidateQueries

## Acceptance Criteria

- [ ] Agent responses appear in real-time without refresh
- [ ] User's own messages still appear immediately (optimistic UI)
- [ ] Multiple tabs viewing same stream stay in sync
- [ ] No full bootstrap refetch after sending messages
- [ ] Events are cached to IndexedDB for offline access

## Notes

This builds on the existing WebSocket infrastructure from websocket-stream-updates. That work handles stream metadata events at the workspace level. This adds message events at the stream level.
