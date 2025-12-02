# Offline-First Architecture Refactor

## Overview

Refactor the frontend to a true offline-first architecture where all data access goes through a local store first, enabling cross-platform code sharing (React Native, Electron) and instant UI responsiveness.

## Current Architecture (Problem)

```
React Components (useStream, useBootstrap)
         ↓ direct fetch + cache calls
    API / WebSocket
         ↓ secondary cache writes
    IndexedDB (reactive, not primary)
```

**Issues:**

1. UI tightly coupled to data fetching (useStream is 1000+ lines)
2. No single source of truth - multiple event sources update React state directly
3. useBootstrap has zero offline support - sidebar/streams fail when offline
4. WebSocket events fire-and-forget cache updates
5. Cache is secondary, not primary - app waits for API

## Proposed Architecture

```
React Components (thin hooks)
         ↓ reads from
    TanStack Query Cache
         ↓ syncs with
    SyncEngine (background)
         ↓
    API / WebSocket
```

**Data Flow:**

1. App loads → reads from TanStack Query cache immediately
2. UI shows cached data instantly
3. Background sync fetches fresh data
4. Events update query cache → UI re-renders
5. Offline writes queue to mutation queue → sync when online

## Key Abstractions

### 1. Storage Interface (Platform-Agnostic Persister)

```typescript
// src/shared/storage/types.ts
interface AsyncStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

// Web: wraps IndexedDB
// React Native: wraps AsyncStorage or MMKV
// Electron: wraps electron-store or SQLite
```

### 2. API Clients (Platform-Agnostic)

```typescript
// src/shared/api/stream-api.ts
export const streamApi = {
  getStream: (workspaceId: string, streamId: string) =>
    fetch(`/api/workspace/${workspaceId}/streams/${streamId}`).then((r) => r.json()),

  getEvents: (workspaceId: string, streamId: string, cursor?: string) =>
    fetch(`/api/workspace/${workspaceId}/streams/${streamId}/events?cursor=${cursor}`).then((r) => r.json()),

  postMessage: (workspaceId: string, streamId: string, data: PostMessageInput) =>
    fetch(`/api/workspace/${workspaceId}/streams/${streamId}/events`, {
      method: "POST",
      body: JSON.stringify(data),
    }).then((r) => r.json()),
}
```

### 3. TanStack Query Hooks

```typescript
// src/frontend/queries/useStreamQuery.ts
export function useStreamQuery(workspaceId: string, streamId: string) {
  return useQuery({
    queryKey: ["stream", workspaceId, streamId],
    queryFn: () => streamApi.getStream(workspaceId, streamId),
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    networkMode: "offlineFirst",
  })
}

// src/frontend/queries/useEventsQuery.ts
export function useEventsQuery(workspaceId: string, streamId: string) {
  return useInfiniteQuery({
    queryKey: ["events", workspaceId, streamId],
    queryFn: ({ pageParam }) => streamApi.getEvents(workspaceId, streamId, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    networkMode: "offlineFirst",
  })
}
```

### 4. Offline Mutation Queue

```typescript
// src/frontend/mutations/usePostMessage.ts
export function usePostMessage(workspaceId: string, streamId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: PostMessageInput) => streamApi.postMessage(workspaceId, streamId, data),
    onMutate: async (data) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["events", workspaceId, streamId] })

      // Create optimistic event
      const optimistic = createOptimisticEvent(data)

      // Update cache immediately
      queryClient.setQueryData(["events", workspaceId, streamId], (old) => ({
        ...old,
        pages: old.pages.map((page, i) =>
          i === old.pages.length - 1 ? { ...page, events: [...page.events, optimistic] } : page,
        ),
      }))

      return { optimistic }
    },
    onSettled: () => {
      // Refetch to get server-confirmed data
      queryClient.invalidateQueries({ queryKey: ["events", workspaceId, streamId] })
    },
    networkMode: "offlineFirst",
    retry: 3,
  })
}
```

## Implementation Plan (TanStack Query + Big Bang Refactor)

### Phase 1: Foundation & Setup

1. Install TanStack Query with persistence
2. Create platform-agnostic storage interface
3. Set up QueryClient with offline persistence

**Dependencies:**

```bash
bun add @tanstack/react-query @tanstack/query-sync-storage-persister
```

**Files to create:**

- `src/shared/storage/types.ts` - platform-agnostic storage interface
- `src/shared/storage/indexeddb-storage.ts` - web implementation (wraps existing offline/db.ts)
- `src/shared/api/stream-api.ts` - API client extracted from hooks
- `src/shared/api/workspace-api.ts` - workspace/bootstrap API
- `src/frontend/lib/query-client.ts` - QueryClient setup with persistence

### Phase 2: Core Query Hooks

Replace existing hooks with TanStack Query versions:

**Files to create:**

- `src/frontend/queries/useStreamQuery.ts` - replaces data fetching in useStream
- `src/frontend/queries/useEventsQuery.ts` - events with infinite scroll
- `src/frontend/queries/useBootstrapQuery.ts` - workspace bootstrap data
- `src/frontend/mutations/usePostMessage.ts` - optimistic message posting
- `src/frontend/mutations/useEditEvent.ts` - event editing

**Configuration:**

```typescript
// Each query configured for offline-first:
useQuery({
  queryKey: ["stream", streamId],
  queryFn: () => streamApi.getStream(streamId),
  staleTime: 5 * 60 * 1000, // 5 min before refetch
  gcTime: 24 * 60 * 60 * 1000, // Keep in cache 24h
  networkMode: "offlineFirst", // Return cache immediately
  refetchOnReconnect: true, // Sync when back online
})
```

### Phase 3: WebSocket Integration

Integrate real-time updates with query cache:

**Files to modify:**

- `src/frontend/hooks/useWorkspaceSocket.ts` - update query cache on events

```typescript
// On WebSocket event:
socket.on("event", (event) => {
  queryClient.setQueryData(["events", event.streamId], (old) => {
    return [...(old || []), event]
  })
})
```

### Phase 4: Outbox for Offline Mutations

Handle offline message posting with mutation queue:

**Files to create:**

- `src/frontend/lib/mutation-persister.ts` - persist pending mutations
- `src/frontend/mutations/useOfflineMutation.ts` - wrapper with queue

```typescript
// Mutation with offline support:
const postMessage = useMutation({
  mutationFn: (data) => streamApi.postMessage(data),
  onMutate: async (data) => {
    // Optimistic update
    await queryClient.cancelQueries(["events", streamId])
    const optimistic = createOptimisticEvent(data)
    queryClient.setQueryData(["events", streamId], (old) => [...old, optimistic])
    return { optimistic }
  },
  onError: (err, data, context) => {
    // Revert on error
    queryClient.setQueryData(["events", streamId], (old) => old.filter((e) => e.id !== context.optimistic.id))
  },
  networkMode: "offlineFirst",
  retry: 3,
})
```

### Phase 5: Delete Old Hooks & Cleanup

1. Remove old useStream implementation (keep thin wrapper for compatibility)
2. Remove old useBootstrap (replace with useBootstrapQuery)
3. Migrate OfflineContext to use TanStack Query's mutation queue
4. Remove redundant caching code from offline/message-cache.ts

## Critical Files to Modify

| File                          | Lines | Priority | Changes                                            |
| ----------------------------- | ----- | -------- | -------------------------------------------------- |
| `hooks/useStream.ts`          | 1000+ | HIGH     | Split into queries/mutations, keep WebSocket logic |
| `hooks/useBootstrap.ts`       | 200   | HIGH     | Replace with useBootstrapQuery                     |
| `App.tsx`                     | -     | HIGH     | Add QueryClientProvider                            |
| `contexts/OfflineContext.tsx` | 200   | MEDIUM   | Simplify - TanStack handles most of this           |
| `lib/offline/db.ts`           | 350   | MEDIUM   | Wrap as TanStack persister                         |
| `lib/offline/outbox.ts`       | 220   | LOW      | May be replaced by mutation queue                  |

## Files to Create

```
src/
├── shared/
│   ├── storage/
│   │   ├── types.ts                 # Platform-agnostic storage interface
│   │   └── indexeddb-storage.ts     # Web implementation
│   └── api/
│       ├── stream-api.ts            # Stream API client
│       ├── workspace-api.ts         # Workspace API client
│       └── types.ts                 # Shared API types
└── frontend/
    ├── lib/
    │   ├── query-client.ts          # QueryClient + persistence setup
    │   └── mutation-persister.ts    # Offline mutation queue
    ├── queries/
    │   ├── useStreamQuery.ts        # Stream data
    │   ├── useEventsQuery.ts        # Events with pagination
    │   └── useBootstrapQuery.ts     # Workspace bootstrap
    └── mutations/
        ├── usePostMessage.ts        # Message posting
        └── useEditEvent.ts          # Event editing
```

## Key Decisions (Resolved)

1. **State Management**: TanStack Query (built-in caching, offline support)
2. **Sync Strategy**: Stale-while-revalidate with background refetch
3. **Cache Expiration**: 5 min staleTime, 24h gcTime (configurable per query)
4. **Conflict Resolution**: Last-write-wins (server is source of truth)
5. **Platform Strategy**: Abstract storage interface, ready for React Native

## Benefits

- Instant UI (cache-first via TanStack Query)
- Works offline by default (networkMode: 'offlineFirst')
- Clean separation: UI hooks | API clients | Storage
- Cross-platform ready (swap storage implementation)
- Built-in devtools, refetch on focus/reconnect, retry logic
- Significantly less custom code than current useStream.ts

## Migration Notes

- `useStream()` consumers get the same API shape initially
- WebSocket events update TanStack Query cache directly
- Existing IndexedDB stores become TanStack persister
- Draft persistence (localStorage) stays as-is
- OfflineContext simplifies to just connectivity status

## Risk Mitigation

- Keep useStream wrapper for backward compatibility during migration
- Run both systems in parallel briefly to verify parity
- Add comprehensive tests before removing old implementation

## Current Migration Status

**Completed:**

- TanStack Query infrastructure set up
- Query hooks created (useBootstrapQuery, useStreamQuery, useEventsQuery)
- Mutation hooks created (usePostMessage, useEditEvent, useShareEvent)
- useStreamWithQuery combines queries + mutations + WebSocket
- StreamInterface migrated to useStreamWithQuery
- LayoutSystem migrated to useBootstrapQuery
- Chat input always enabled (can type offline)

**Legacy Systems (Still Active):**

- `src/frontend/lib/offline/` - Old IndexedDB caching (used by drafts, OfflineContext)
- `src/frontend/hooks/useStream.ts` - Deprecated, kept as reference
- `src/frontend/contexts/OfflineContext.tsx` - Handles outbox processing

**Next Steps:**

- Add TanStack Query mutation persistence (for offline message queue)
- Implement Drafts space in sidebar
- Consider removing old caching system after verification

## Multi-Workspace Support

Query keys include workspaceId to support multiple workspaces:

```typescript
// All queries scoped by workspace
queryKey: ["stream", workspaceId, streamId]
queryKey: ["events", workspaceId, streamId]
queryKey: ["bootstrap", workspaceId]
```

- Cache is partitioned per workspace automatically
- Switching workspaces shows cached data instantly
- Each workspace syncs independently
