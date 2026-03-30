# Redesigned Sync Engine: Offline-First with IndexedDB as Source of Truth

## Context

Threa's frontend currently uses TanStack Query (in-memory cache) as the primary data source, with IndexedDB (Dexie) as a secondary persistence layer. This causes several problems on unreliable mobile connections:

- **Messages not loaded on push notification open** — stream events aren't seeded from IDB; bootstrap must complete (requires socket) before anything renders
- **App needs loading time** — cold start only seeds workspace data (sidebar), not stream events
- **Sometimes needs refresh** — event gaps from reconnection races and bootstrap invalidation timing
- **Offline doesn't work** — everything gated on `enabled: !!socket`; no offline indicator
- **Messages can be lost** — MAX_RETRY_COUNT=3 then message deleted from outbox
- **Dual-write divergence** — socket events write to both TanStack cache AND IDB; timing bugs cause stale/missing data

**The fix**: Invert the data flow. IndexedDB becomes the single source of truth. All network data (HTTP + socket) writes to IndexedDB. UI subscribes reactively via Dexie `useLiveQuery`. TanStack Query is demoted to fetch orchestration for non-subscribable data only.

```
Current:  Socket/HTTP → TanStack Cache → UI  (+ async persist to IDB)
Target:   Socket/HTTP → IndexedDB → UI  (via useLiveQuery)
```

---

## Design Decisions

### Why Dexie `useLiveQuery` over TanStack Query for persistent data

| Concern | TanStack Query | Dexie liveQuery |
|---------|---------------|-----------------|
| Offline reads | Requires seed + gcTime: Infinity to survive | Always reads from disk |
| Cache coherence | Two caches (memory + IDB) can diverge | Single source of truth |
| Eviction | gcTime can evict; broken offline | No eviction concept |
| Reactivity | Needs manual `setQueryData`/invalidation | Automatic on write |
| Loading state | Built-in | Need custom SyncStatus layer |
| Pagination | Built-in infinite queries | Manual (but IDB indexes are efficient) |

**Decision**: Use `useLiveQuery` for all mutable, subscribable entity data (messages, streams, users, memberships, settings). Keep TanStack Query only for: mutations, non-persistent queries (search, AI usage), and pagination fetch orchestration (results still written to IDB).

### Why a SyncEngine class instead of hooks

The current sync logic is scattered across ~8 React hooks that communicate via TanStack Query cache side-effects. This makes reconnection, ordering, and error handling fragile. A single `SyncEngine` class:
- Owns the subscribe-then-fetch lifecycle (INV-53)
- Owns reconnection orchestration
- Is testable without React
- Is constructed once (INV-13) and provided via context

### Why no cross-tab data reactivity

Each tab has its own socket connection receiving the same events. Each tab writes to the same IDB, and `useLiveQuery` observes that tab's own writes. Cross-tab IDB observation (via Dexie.Observable addon) is not needed because:
1. Each tab independently receives and writes the same data via its own socket
2. The only cross-tab concern is the message outbox (solved by Web Locks API)

---

## Architecture

### Data Layer

```
┌──────────────────────────────────────────────────────┐
│                   React Components                     │
│  useStreamEvents(streamId) → CachedEvent[]             │
│  useWorkspaceStreams(wsId) → CachedStream[]             │
│  useWorkspaceUsers(wsId)  → CachedWorkspaceUser[]       │
│  useSyncStatus(key)       → SyncStatus                  │
└──────────┬──────────────────────┬────────────────────┘
           │ useLiveQuery         │ useSyncExternalStore
┌──────────▼──────────┐  ┌───────▼────────────────────┐
│  Dexie IndexedDB     │  │  SyncStatus Store           │
│  (source of truth)   │  │  (transient session state)  │
│                      │  │  Map<key, SyncStatus>       │
└──────────▲──────────┘  └───────▲────────────────────┘
           │ write                │ setStatus
┌──────────┴──────────────────────┴────────────────────┐
│                   Sync Engine                          │
│  • Workspace bootstrap → shreds into IDB tables        │
│  • Stream bootstrap → writes events + metadata to IDB  │
│  • Socket events → writes to IDB (never TanStack)      │
│  • Reconnect → re-bootstrap all subscribed resources    │
│  • Message outbox → sends pending, never drops          │
└──────────────────────────────────────────────────────┘
```

### Store Hooks (new: `apps/frontend/src/stores/`)

Each entity type gets a typed hook backed by `useLiveQuery`:

```typescript
// stores/stream-store.ts
export function useStreamEvents(streamId: string): CachedEvent[] {
  return useLiveQuery(
    () => db.events.where("streamId").equals(streamId).sortBy("sequence"),
    [streamId],
    [] // default while query resolves
  )
}

export function useStream(workspaceId: string, streamId: string): CachedStream | undefined {
  return useLiveQuery(() => db.streams.get(streamId), [streamId])
}

// stores/workspace-store.ts
export function useWorkspaceStreams(workspaceId: string): CachedStream[] {
  return useLiveQuery(
    () => db.streams.where("workspaceId").equals(workspaceId).toArray(),
    [workspaceId],
    []
  )
}

export function useWorkspaceUsers(workspaceId: string): CachedWorkspaceUser[] {
  return useLiveQuery(
    () => db.workspaceUsers.where("workspaceId").equals(workspaceId).toArray(),
    [workspaceId],
    []
  )
}

export function useStreamMemberships(workspaceId: string): CachedStreamMembership[] {
  return useLiveQuery(
    () => db.streamMemberships.where("workspaceId").equals(workspaceId).toArray(),
    [workspaceId],
    []
  )
}
```

### Sync Status (new: `apps/frontend/src/sync/sync-status.ts`)

Transient session state, not persisted. Uses `useSyncExternalStore` for efficient per-key subscriptions:

```typescript
type SyncStatus = "idle" | "syncing" | "synced" | "stale" | "error"

// Keys: "workspace:{id}", "stream:{streamId}"
class SyncStatusStore {
  private statuses = new Map<string, SyncStatus>()
  private listeners = new Map<string, Set<() => void>>()

  get(key: string): SyncStatus { return this.statuses.get(key) ?? "idle" }
  set(key: string, status: SyncStatus): void { /* update + notify key listeners */ }
  setAllStale(): void { /* mark everything stale on disconnect */ }
  subscribe(key: string, listener: () => void): () => void { /* for useSyncExternalStore */ }
}

// React hook
export function useSyncStatus(key: string): SyncStatus {
  const store = useSyncStatusStore() // from context
  return useSyncExternalStore(
    (cb) => store.subscribe(key, cb),
    () => store.get(key)
  )
}
```

### Sync Engine (new: `apps/frontend/src/sync/sync-engine.ts`)

```typescript
export class SyncEngine {
  private socket: Socket | null = null
  private subscribedStreams = new Set<string>()
  private cleanupFns: (() => void)[] = []

  constructor(private deps: {
    workspaceId: string
    syncStatus: SyncStatusStore
    workspaceApi: WorkspaceApi
    streamApi: StreamApi
    messageService: MessageService
  }) {}

  // Called by SocketProvider when socket connects
  async onConnect(socket: Socket, isReconnect: boolean): Promise<void> {
    this.socket = socket
    if (isReconnect) this.deps.syncStatus.setAllStale()

    // 1. Subscribe-then-fetch workspace (INV-53)
    await this.bootstrapWorkspace()

    // 2. Register workspace socket handlers (write to IDB only)
    this.cleanupFns.push(registerWorkspaceSocketHandlers(socket, this.deps))

    // 3. Subscribe all member streams
    const memberships = await db.streamMemberships
      .where("workspaceId").equals(this.deps.workspaceId).toArray()
    for (const m of memberships) {
      await this.subscribeStream(m.streamId)
    }
  }

  onDisconnect(): void {
    this.deps.syncStatus.setAllStale()
  }

  async subscribeStream(streamId: string): Promise<void> {
    if (this.subscribedStreams.has(streamId)) return
    this.subscribedStreams.add(streamId)

    this.deps.syncStatus.set(`stream:${streamId}`, "syncing")

    // Subscribe-then-fetch (INV-53)
    this.socket?.emit("join", `ws:${this.deps.workspaceId}:stream:${streamId}`)
    this.cleanupFns.push(
      registerStreamSocketHandlers(this.socket!, this.deps.workspaceId, streamId)
    )

    try {
      const bootstrap = await this.deps.streamApi.bootstrap(this.deps.workspaceId, streamId)
      await applyStreamBootstrap(streamId, bootstrap) // writes to IDB
      this.deps.syncStatus.set(`stream:${streamId}`, "synced")
    } catch (error) {
      const hasCached = (await db.events.where("streamId").equals(streamId).count()) > 0
      this.deps.syncStatus.set(`stream:${streamId}`, hasCached ? "stale" : "error")
      if (hasCached) toast.warning("Showing cached messages. Could not refresh.")
    }
  }

  unsubscribeStream(streamId: string): void { /* leave room, remove handlers */ }
  destroy(): void { /* cleanup all */ }
}
```

### Workspace Bootstrap Decomposition

The monolithic `WorkspaceBootstrap` response is shredded into individual IDB tables:

```typescript
// sync/workspace-sync.ts
async function applyWorkspaceBootstrap(workspaceId: string, bootstrap: WorkspaceBootstrap) {
  const now = Date.now()
  await db.transaction("rw",
    [db.workspaces, db.workspaceUsers, db.streams, db.streamMemberships,
     db.dmPeers, db.personas, db.bots, db.unreadState, db.userPreferences],
    async () => {
      await db.workspaces.put({ ...bootstrap.workspace, _cachedAt: now })
      await db.workspaceUsers.bulkPut(bootstrap.users.map(u => ({ ...u, _cachedAt: now })))
      await db.streams.bulkPut(bootstrap.streams.map(s => ({ ...s, _cachedAt: now })))
      await db.streamMemberships.bulkPut(
        bootstrap.streamMemberships.map(sm => ({
          ...sm,
          id: `${workspaceId}:${sm.streamId}`,
          workspaceId,
          _cachedAt: now,
        }))
      )
      await db.dmPeers.bulkPut(
        bootstrap.dmPeers.map(dp => ({
          ...dp,
          id: `${workspaceId}:${dp.streamId}`,
          workspaceId,
          _cachedAt: now,
        }))
      )
      await db.personas.bulkPut(bootstrap.personas.map(p => ({ ...p, _cachedAt: now })))
      await db.bots.bulkPut(bootstrap.bots.map(b => ({ ...b, _cachedAt: now })))
      await db.unreadState.put({
        id: workspaceId,
        workspaceId,
        unreadCounts: bootstrap.unreadCounts,
        mentionCounts: bootstrap.mentionCounts,
        activityCounts: bootstrap.activityCounts,
        unreadActivityCount: bootstrap.unreadActivityCount,
        mutedStreamIds: bootstrap.mutedStreamIds,
        _cachedAt: now,
      })
      await db.userPreferences.put({
        id: workspaceId,
        workspaceId,
        ...bootstrap.userPreferences,
        _cachedAt: now,
      })
    }
  )
}
```

### Stream Bootstrap Write

```typescript
// sync/stream-sync.ts
async function applyStreamBootstrap(streamId: string, bootstrap: StreamBootstrap) {
  const now = Date.now()
  await db.transaction("rw", [db.events, db.streams], async () => {
    // Clean stale optimistic events (temp_*) that now have real versions
    const tempEvents = await db.events
      .where("streamId").equals(streamId)
      .filter(e => e.id.startsWith("temp_"))
      .toArray()
    const realEventIds = new Set(bootstrap.events.map(e => e.id))
    for (const temp of tempEvents) {
      // If the optimistic event's content matches a real event, delete it
      // Also check if it's still in pendingMessages (if so, keep it)
      const stillPending = await db.pendingMessages.get(temp.id)
      if (!stillPending) await db.events.delete(temp.id)
    }

    await db.events.bulkPut(
      bootstrap.events.map(e => ({ ...e, _cachedAt: now }))
    )
    await db.streams.put({ ...bootstrap.stream, _cachedAt: now })
  })
}
```

### Socket Event Handlers (IDB-only writes)

```typescript
// sync/stream-sync.ts
export function registerStreamSocketHandlers(
  socket: Socket,
  workspaceId: string,
  streamId: string
): () => void {
  const handlers: Record<string, (payload: any) => Promise<void>> = {
    "message:created": async (payload) => {
      const now = Date.now()
      const clientMsgId = payload.event?.payload?.clientMessageId

      await db.transaction("rw", [db.events, db.pendingMessages], async () => {
        // Swap optimistic event for real one
        if (clientMsgId) {
          await db.events.delete(clientMsgId)
          await db.pendingMessages.delete(clientMsgId)
        }
        await db.events.put({ ...payload.event, _cachedAt: now })
      })
    },

    "message:edited": async (payload) => {
      await db.events.update(payload.event.id, {
        payload: payload.event.payload,
        _cachedAt: Date.now(),
      })
    },

    "message:deleted": async (payload) => {
      await db.events.update(payload.event.id, {
        payload: { ...payload.event.payload, deletedAt: payload.event.payload.deletedAt },
        _cachedAt: Date.now(),
      })
    },

    "reaction:added": async (payload) => {
      const event = await db.events.get(payload.messageEventId)
      if (!event) return
      const reactions = { ...(event.payload as any).reactions }
      const users = reactions[payload.emoji] ?? []
      if (!users.includes(payload.userId)) {
        reactions[payload.emoji] = [...users, payload.userId]
      }
      await db.events.update(event.id, {
        payload: { ...(event.payload as any), reactions },
        _cachedAt: Date.now(),
      })
    },

    "reaction:removed": async (payload) => {
      const event = await db.events.get(payload.messageEventId)
      if (!event) return
      const reactions = { ...(event.payload as any).reactions }
      reactions[payload.emoji] = (reactions[payload.emoji] ?? []).filter(
        (id: string) => id !== payload.userId
      )
      if (reactions[payload.emoji].length === 0) delete reactions[payload.emoji]
      await db.events.update(event.id, {
        payload: { ...(event.payload as any), reactions },
        _cachedAt: Date.now(),
      })
    },

    // ... other handlers follow same pattern
  }

  for (const [event, handler] of Object.entries(handlers)) {
    socket.on(event, handler)
  }
  return () => { for (const event of Object.keys(handlers)) socket.off(event) }
}
```

### Message Outbox Redesign

```typescript
// sync/outbox.ts
export class MessageOutbox {
  private processing = false
  private pendingNotify = false

  constructor(private deps: {
    messageService: MessageService
    attachmentApi: AttachmentApi
    isOnline: () => boolean
  }) {}

  async enqueue(msg: Omit<PendingMessage, "retryCount" | "retryAfter">): Promise<void> {
    await db.pendingMessages.add({ ...msg, retryCount: 0, retryAfter: 0 })

    // Write optimistic event to events table
    await db.events.put({
      id: msg.clientId,
      streamId: msg.streamId,
      sequence: String(Date.now()), // sorts after real events
      eventType: "message_created",
      payload: {
        messageId: msg.clientId,
        contentJson: msg.contentJson,
        contentMarkdown: msg.content,
        attachments: msg.attachmentIds?.length ? [] : undefined, // placeholder
      },
      actorId: msg.userId,
      actorType: "user",
      createdAt: new Date().toISOString(),
      _clientId: msg.clientId,
      _status: "pending",
      _cachedAt: Date.now(),
    })

    this.kick()
  }

  kick(): void {
    if (this.processing) { this.pendingNotify = true; return }
    void this.processQueue()
  }

  private async processQueue(): Promise<void> {
    // Cross-tab lock: only one tab processes at a time
    if (!navigator.locks) {
      await this.drainQueue()
      return
    }
    await navigator.locks.request("threa-outbox", { ifAvailable: true }, async (lock) => {
      if (!lock) return // Another tab is processing
      await this.drainQueue()
    })
  }

  private async drainQueue(): Promise<void> {
    this.processing = true
    this.pendingNotify = false
    const now = Date.now()
    const skipped = new Set<string>()

    try {
      while (true) {
        if (!this.deps.isOnline()) break

        const candidates = await db.pendingMessages.orderBy("createdAt").toArray()
        const next = candidates.find(m =>
          !skipped.has(m.clientId) && (m.retryAfter ?? 0) <= now
        )
        if (!next) break

        // Handle pending uploads first
        if (next.pendingUploads?.some(u => u.status !== "uploaded")) {
          const allUploaded = await this.processUploads(next)
          if (!allUploaded) { skipped.add(next.clientId); continue }
        }

        await db.events.update(next.clientId, { _status: "pending" })

        try {
          const allAttachmentIds = [
            ...(next.attachmentIds ?? []),
            ...(next.pendingUploads ?? [])
              .filter(u => u.status === "uploaded")
              .map(u => u.uploadedAttachmentId!),
          ]

          await this.deps.messageService.create(next.workspaceId, next.streamId, {
            streamId: next.streamId,
            contentJson: next.contentJson!,
            contentMarkdown: next.content,
            attachmentIds: allAttachmentIds.length > 0 ? allAttachmentIds : undefined,
            clientMessageId: next.clientId,
          })

          // Success: remove from outbox (socket handler replaces optimistic event)
          await db.pendingMessages.delete(next.clientId)
        } catch {
          const retryCount = next.retryCount + 1
          const delay = getRetryDelay(retryCount)
          await (db.pendingMessages.update as any)(next.clientId, {
            retryCount,
            retryAfter: Date.now() + delay,
          })
          await db.events.update(next.clientId, { _status: "failed" })
          skipped.add(next.clientId)
        }
      }
    } finally {
      this.processing = false
      if (this.pendingNotify) { this.pendingNotify = false; void this.processQueue() }
    }
  }
}

function getRetryDelay(retryCount: number): number {
  if (retryCount <= 3) return 0
  if (retryCount <= 6) return 5_000
  if (retryCount <= 10) return 30_000
  return 120_000 // 2 min cap
}
```

### Push Notification Deep Linking

Three changes:

**1. SW includes `?m=messageId` in notification URL**

```typescript
// sw.ts notificationclick handler
if (data?.workspaceId && data?.streamId) {
  targetUrl = data.messageId
    ? `/w/${data.workspaceId}/s/${data.streamId}?m=${data.messageId}`
    : `/w/${data.workspaceId}/s/${data.streamId}`
}
```

**2. SW prefetch writes events to IndexedDB** (not just Cache API)

```typescript
async function prefetchStreamBootstrap(workspaceId: string, streamId: string): Promise<void> {
  const url = `/api/workspaces/${workspaceId}/streams/${streamId}/bootstrap`
  const response = await fetch(url, { credentials: "include" })
  if (!response.ok) return

  // Cache for fetch intercept (existing behavior)
  const cache = await caches.open(PUSH_BOOTSTRAP_CACHE)
  await cache.put(url, response.clone())

  // Write events to IDB so useLiveQuery renders them instantly
  try {
    const { data: bootstrap } = await response.json()
    const now = Date.now()
    // Import Dexie db (SW has access to same IDB)
    const { db } = await import("./db/database")
    await db.events.bulkPut(bootstrap.events.map((e: any) => ({ ...e, _cachedAt: now })))
    await db.streams.put({ ...bootstrap.stream, _cachedAt: now })
  } catch { /* best-effort */ }
}
```

**3. Stream view guarantees target message is visible**

```typescript
// In stream content component
const targetMessageId = searchParams.get("m")
const events = useStreamEvents(streamId) // from IDB

useEffect(() => {
  if (!targetMessageId) return
  const found = events.some(e => e.id === targetMessageId ||
    (e.payload as any)?.messageId === targetMessageId)
  if (found) {
    scrollToEvent(targetMessageId)
    return
  }
  // Not in cache - fetch surrounding events
  if (syncStatus !== "syncing") {
    jumpToEvent(targetMessageId) // existing API call + write to IDB
  }
}, [targetMessageId, events.length, syncStatus])
```

### Offline Indicator

```typescript
// components/layout/connection-status.tsx
export function ConnectionStatus() {
  const socketStatus = useSocketStatus()
  const isOnline = useSyncExternalStore(
    (cb) => { window.addEventListener("online", cb); window.addEventListener("offline", cb); return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb) } },
    () => navigator.onLine
  )

  if (socketStatus === "connected") return null
  if (!isOnline) return <Banner variant="warning">You're offline. Messages will send when you reconnect.</Banner>
  if (socketStatus === "reconnecting") return <Banner variant="info">Reconnecting...</Banner>
  if (socketStatus === "disconnected") return <Banner variant="error">Connection lost. <button>Retry</button></Banner>
  return null
}
```

Placed in workspace layout, above main content area. Non-blocking.

### New Dexie Tables (v15)

```typescript
// database.ts addition
this.version(15).stores({
  unreadState: "id, workspaceId",
  userPreferences: "id, workspaceId",
})
```

`unreadState` stores: `{ id: workspaceId, unreadCounts, mentionCounts, activityCounts, unreadActivityCount, mutedStreamIds, _cachedAt }`

`userPreferences` stores: the full `UserPreferences` object per workspace.

### `PendingMessage` schema changes

Add to existing `PendingMessage` interface:
- `retryAfter: number` — timestamp before which this message should not be retried
- `pendingUploads?: PendingUpload[]` — file uploads that must complete before sending
- `userId: string` — for optimistic event creation (actorId)

```typescript
interface PendingUpload {
  localId: string
  filename: string
  mimeType: string
  sizeBytes: number
  blobKey: string // key in a separate IDB object store for file blobs
  status: "pending" | "uploading" | "uploaded" | "failed"
  uploadedAttachmentId?: string
}
```

Add a new Dexie table for file blobs: `pendingBlobs: "key"` (stores raw File/Blob data).

---

## Implementation Phases

### Phase 1: Stream Events from IndexedDB (highest impact, solves push + cold start)

**Goal**: Messages render from IndexedDB, not TanStack cache. Fixes: push notification message not loaded, slow cold start, sometimes-stale messages.

**Changes**:
1. Create `apps/frontend/src/stores/stream-store.ts` — `useStreamEvents(streamId)` via `useLiveQuery`
2. Update stream bootstrap (`use-streams.ts`) to write events to IDB instead of TanStack cache
3. Update `use-stream-socket.ts` handlers to write events to IDB only (remove `setQueryData` calls for events)
4. Update `use-events.ts` to source from `useStreamEvents` instead of bootstrap cache
5. Update timeline components to read from store hooks
6. Update SW: add `?m=messageId` to notification URL, write events to IDB in prefetch
7. Add v15 Dexie migration

**Files to modify**:
- New: `apps/frontend/src/stores/stream-store.ts`
- `apps/frontend/src/hooks/use-events.ts` — rewrite data source
- `apps/frontend/src/hooks/use-stream-socket.ts` — IDB-only writes for events
- `apps/frontend/src/hooks/use-streams.ts` — bootstrap writes events to IDB
- `apps/frontend/src/sw.ts` — messageId in URL + IDB write in prefetch
- `apps/frontend/src/db/database.ts` — v15 schema
- `apps/frontend/src/components/timeline/stream-content.tsx` — use store hook

**Shippable independently**: Yes. Workspace-level data continues on TanStack Query.

### Phase 2: Message Outbox Redesign (solves message loss + upload blocking)

**Goal**: Messages never lost. Uploads don't block sending. Clear retry UI.

**Changes**:
1. Remove `MAX_RETRY_COUNT` — messages stay in outbox until confirmed
2. Add exponential backoff via `retryAfter` field
3. Add `pendingUploads` to PendingMessage for file upload dependency tracking
4. Add `pendingBlobs` table for file data persistence
5. Add Web Locks for cross-tab outbox safety
6. Update send path to always enqueue (even with pending uploads)
7. Add explicit "Retry" and "Delete" actions on failed messages in timeline
8. Remove auto-delete on failure

**Files to modify**:
- `apps/frontend/src/hooks/use-message-queue.ts` — major rewrite → `apps/frontend/src/sync/outbox.ts`
- `apps/frontend/src/contexts/pending-messages-context.tsx` — simplify (status from IDB `_status`)
- `apps/frontend/src/hooks/use-stream-or-draft.ts` — update send path
- `apps/frontend/src/db/database.ts` — schema changes
- Timeline message components — failed message UI

**Shippable independently**: Yes.

### Phase 3: Workspace Data to IndexedDB + SyncEngine + Offline (completes the vision)

**Goal**: Full offline-first. Sidebar, users, settings all from IDB. Offline indicator. SyncEngine owns lifecycle.

**Changes**:
1. Create `apps/frontend/src/stores/workspace-store.ts` — all workspace-level store hooks
2. Create `apps/frontend/src/sync/sync-engine.ts` — orchestrates all sync
3. Create `apps/frontend/src/sync/workspace-sync.ts` — workspace socket handlers (IDB-only)
4. Create `apps/frontend/src/sync/sync-status.ts` — SyncStatusStore + `useSyncStatus` hook
5. Create `apps/frontend/src/components/layout/connection-status.tsx` — offline banner
6. Migrate `use-socket-events.ts` handlers to IDB-only writes
7. Migrate all components from `useWorkspaceBootstrap` to store hooks
8. Replace cache-only observer pattern with `useLiveQuery` calls
9. Delete `apps/frontend/src/lib/cache-seed.ts` (no longer needed)
10. Delete `apps/frontend/src/hooks/use-reconnect-bootstrap.ts` (sync engine handles it)
11. Provide SyncEngine via context in workspace layout

**Sub-phases for safety**:
- 3a: Add store hooks alongside existing hooks (dual-read period for validation)
- 3b: Migrate component consumers one by one
- 3c: Remove old hooks, cache-seed, TanStack cache writes

**Files to modify** (major):
- New: `apps/frontend/src/stores/workspace-store.ts`
- New: `apps/frontend/src/sync/sync-engine.ts`
- New: `apps/frontend/src/sync/workspace-sync.ts`
- New: `apps/frontend/src/sync/stream-sync.ts` (consolidate from Phase 1)
- New: `apps/frontend/src/sync/sync-status.ts`
- New: `apps/frontend/src/components/layout/connection-status.tsx`
- Rewrite: `apps/frontend/src/hooks/use-socket-events.ts`
- Delete: `apps/frontend/src/lib/cache-seed.ts`
- Delete: `apps/frontend/src/hooks/use-reconnect-bootstrap.ts`
- Update: ~30+ component files consuming workspace bootstrap

**Shippable independently**: Yes, but large. Sub-phases recommended.

### Phase 4: Cleanup

1. Remove all remaining cache-only observer patterns
2. Audit TanStack Query usage — keep only for non-subscribable data
3. Remove `structuralSharing: false` workarounds
4. Simplify coordinated loading context
5. Update/add tests
6. Remove unused query key factories

---

## What We Keep

- **Socket.io** connection management (`socket-context.tsx`) — unchanged
- **TanStack Query** — demoted to mutations + non-subscribable fetches (search, AI usage, etc.)
- **Dexie** schema + migration infrastructure — extended with new tables
- **Service layer** (API clients) — unchanged
- **INV-53 subscribe-then-fetch** — same pattern, writes to IDB instead of TanStack
- **Draft system** — already uses IDB, unchanged
- **Service worker** Workbox precaching — unchanged
- **Push notification system** — enhanced, not replaced

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Socket event arrives for unsynced stream | Write to IDB anyway; bootstrap overwrites with full data when it runs |
| IndexedDB quota exceeded | Evict events older than 7 days, retry write |
| Multiple tabs | Each has own socket + sync engine; IDB writes are idempotent; outbox uses Web Locks |
| Bootstrap races with socket events | Not a problem — IDB writes are idempotent by ID; last write wins |
| Stale IDB data from weeks ago | SyncStatus shows "stale" until bootstrap completes; user sees old data with loading indicator |

## Verification

After each phase:
1. **Cold start offline**: Open PWA in airplane mode → sidebar and cached messages render immediately
2. **Push notification**: Receive push → tap → message visible instantly (or after short sync)
3. **Send while offline**: Type message → send → shows as "pending" → go online → message delivered
4. **Kill and reopen**: Force close app → reopen → unsent messages still in outbox, cached data visible
5. **Reconnection**: Disable WiFi for 30s → re-enable → messages that arrived during gap appear
6. **File upload + send**: Attach file → send immediately → message shows as "sending" → file uploads → message delivers
7. Run `bun run test` and `bun run test:e2e`
