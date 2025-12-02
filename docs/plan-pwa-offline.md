# PWA & Offline Support Implementation Plan

## Overview

Implement full PWA support with offline capabilities for Threa, enabling:

1. Offline message viewing from cached streams
2. Offline message composition with automatic sync when online
3. Draft persistence across page reloads and network loss
4. Asset caching for instant app startup
5. Seamless connectivity handling with background refresh

## Architecture

### Core Components

```
src/frontend/
├── lib/
│   ├── offline/
│   │   ├── db.ts              # IndexedDB wrapper (Dexie or raw IDB)
│   │   ├── message-cache.ts   # Message/event caching logic
│   │   ├── draft-store.ts     # Draft persistence per stream
│   │   ├── outbox.ts          # Queued messages pending send
│   │   └── sync.ts            # Background sync coordination
│   └── connectivity.ts        # Online/offline detection
├── contexts/
│   └── OfflineContext.tsx     # React context for offline state
├── hooks/
│   └── useOffline.ts          # Hook for offline state
├── service-worker.ts          # Service worker entry point
└── manifest.json              # PWA manifest
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Application                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  useStream hook                                                 │
│    │                                                            │
│    ├─── Online: Fetch from API → Update Cache → Return data     │
│    │                                                            │
│    └─── Offline: Return from Cache → Queue for refresh          │
│                                                                 │
│  ChatInput + RichTextEditor                                     │
│    │                                                            │
│    ├─── Every keystroke: Debounced save to DraftStore           │
│    │                                                            │
│    └─── On submit:                                              │
│           Online: Send to API                                   │
│           Offline: Add to Outbox → Return optimistic response   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                        IndexedDB                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Stores:                                                        │
│    - streams      → cached stream metadata                      │
│    - events       → cached events by stream (indexed)           │
│    - drafts       → per-stream draft content + mentions         │
│    - outbox       → pending messages with retry state           │
│    - sync-state   → last sync time, pagination cursors          │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                      Service Worker                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  - Cache API assets (HTML, JS, CSS, images)                     │
│  - Background Sync API for outbox processing                    │
│  - Periodic Sync for message refresh (if supported)             │
│  - Push notifications (future)                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Phase 1: IndexedDB Foundation

**1.1 Create IndexedDB wrapper (`src/frontend/lib/offline/db.ts`)**

Use native IndexedDB with a thin wrapper for type safety and migrations:

```typescript
// Schema definition
interface ThreaDB {
  streams: {
    key: string
    value: Stream & { cachedAt: number }
    indexes: { workspaceId: string }
  }
  events: {
    key: string
    value: StreamEvent & { streamId: string; cachedAt: number }
    indexes: { streamId: string; createdAt: number }
  }
  drafts: {
    key: string // streamId
    value: {
      streamId: string
      content: string
      mentions: Mention[]
      updatedAt: number
    }
  }
  outbox: {
    key: string // generated id
    value: {
      id: string
      streamId: string
      content: string
      mentions: Mention[]
      createdAt: number
      status: "pending" | "sending" | "failed"
      retryCount: number
      lastError?: string
    }
  }
  syncState: {
    key: string // streamId or 'bootstrap'
    value: {
      id: string
      lastSyncAt: number
      oldestEventId?: string
      newestEventId?: string
    }
  }
}
```

**1.2 Create message cache (`src/frontend/lib/offline/message-cache.ts`)**

```typescript
export class MessageCache {
  // Store events for a stream (called after successful fetch)
  async cacheEvents(streamId: string, events: StreamEvent[]): Promise<void>

  // Get cached events (for offline viewing)
  async getEvents(streamId: string, limit?: number): Promise<StreamEvent[]>

  // Merge new events (for real-time updates while offline)
  async mergeEvent(event: StreamEvent): Promise<void>

  // Clear old cache entries (LRU with size limits)
  async pruneCache(maxAgeMs?: number, maxEventsPerStream?: number): Promise<void>
}
```

**1.3 Create draft store (`src/frontend/lib/offline/draft-store.ts`)**

```typescript
export class DraftStore {
  // Save draft (debounced, called on every edit)
  async saveDraft(streamId: string, content: string, mentions: Mention[]): Promise<void>

  // Load draft (called when opening a stream)
  async getDraft(streamId: string): Promise<{ content: string; mentions: Mention[] } | null>

  // Clear draft (called after successful send)
  async clearDraft(streamId: string): Promise<void>
}
```

**1.4 Create outbox (`src/frontend/lib/offline/outbox.ts`)**

```typescript
export class Outbox {
  // Add message to outbox (called when offline or send fails)
  async addMessage(streamId: string, content: string, mentions: Mention[]): Promise<OutboxMessage>

  // Get pending messages for a stream
  async getPendingForStream(streamId: string): Promise<OutboxMessage[]>

  // Get all pending messages
  async getAllPending(): Promise<OutboxMessage[]>

  // Update message status
  async updateStatus(id: string, status: OutboxStatus, error?: string): Promise<void>

  // Remove message (after successful send)
  async remove(id: string): Promise<void>

  // Process outbox (attempt to send all pending)
  async processOutbox(): Promise<ProcessResult>
}
```

### Phase 2: Connectivity Detection

**2.1 Create connectivity module (`src/frontend/lib/connectivity.ts`)**

```typescript
export type ConnectionState = "online" | "offline" | "reconnecting"

export interface ConnectivityManager {
  // Current state
  state: ConnectionState

  // Subscribe to state changes
  subscribe(callback: (state: ConnectionState) => void): () => void

  // Manual check (fetch a small endpoint)
  checkConnectivity(): Promise<boolean>
}

// Implementation uses:
// - navigator.onLine (coarse, instant)
// - Periodic fetch to /api/ping (fine-grained)
// - WebSocket connection state (real-time indicator)
```

**2.2 Create OfflineContext (`src/frontend/contexts/OfflineContext.tsx`)**

```typescript
interface OfflineContextValue {
  // Connection state
  isOnline: boolean
  connectionState: ConnectionState

  // Outbox state
  pendingMessageCount: number

  // Actions
  retryPending: () => Promise<void>
  clearOutbox: () => Promise<void>
}
```

### Phase 3: Hook Integration

**3.1 Enhance useStream hook**

Modify `src/frontend/hooks/useStream.ts` to:

1. **On mount**: Check cache first, return cached data immediately
2. **On fetch success**: Update cache with new events
3. **On fetch failure**: Fall back to cached data
4. **On WebSocket message**: Merge into cache
5. **On send (offline)**: Add to outbox, return optimistic response

```typescript
// Inside useStream:

const fetchStreamData = async () => {
  // Try cache first for instant display
  const cachedEvents = await messageCache.getEvents(streamId)
  if (cachedEvents.length > 0) {
    setEvents(cachedEvents)
    setIsLoading(false)
  }

  try {
    // Fetch fresh data
    const freshEvents = await fetchFromAPI()
    setEvents(freshEvents)
    // Update cache
    await messageCache.cacheEvents(streamId, freshEvents)
  } catch (error) {
    if (cachedEvents.length === 0) {
      // No cache and failed - show error
      setConnectionError("Unable to load messages")
    }
    // Otherwise, we're showing cached data - that's fine
  }
}

const postMessage = async (content: string, mentions?: Mention[]) => {
  // Clear draft on successful submit intent
  await draftStore.clearDraft(streamId)

  if (!isOnline) {
    // Add to outbox
    const outboxMsg = await outbox.addMessage(streamId, content, mentions)
    // Create optimistic event for immediate display
    const optimisticEvent = createOptimisticEvent(outboxMsg)
    setEvents((prev) => [...prev, optimisticEvent])
    return
  }

  // Normal online flow...
}
```

**3.2 Enhance ChatInput/RichTextEditor**

Modify to:

1. Load draft on mount
2. Debounce-save draft on every change
3. Clear draft after successful send

```typescript
// In ChatInput or RichTextEditor:

// Load draft on stream change
useEffect(() => {
  draftStore.getDraft(streamId).then((draft) => {
    if (draft) {
      editorRef.current?.setContent(draft.content)
      // Restore mentions somehow...
    }
  })
}, [streamId])

// Save draft on change (debounced)
const saveDraft = useMemo(
  () =>
    debounce(async (content: string, mentions: Mention[]) => {
      await draftStore.saveDraft(streamId, content, mentions)
    }, 500),
  [streamId],
)

// Clear draft on send
const handleSend = async () => {
  await onSend(content, mentions)
  await draftStore.clearDraft(streamId)
}
```

### Phase 4: Service Worker

**4.1 Create service worker (`src/frontend/service-worker.ts`)**

```typescript
/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope

import { precacheAndRoute } from "workbox-precaching"
import { registerRoute } from "workbox-routing"
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from "workbox-strategies"

// Precache app shell
precacheAndRoute(self.__WB_MANIFEST)

// Cache static assets (JS, CSS, images)
registerRoute(
  ({ request }) =>
    request.destination === "script" || request.destination === "style" || request.destination === "image",
  new CacheFirst({
    cacheName: "static-assets",
  }),
)

// Network-first for API calls (with fallback to cache for GET)
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/"),
  new NetworkFirst({
    cacheName: "api-cache",
    networkTimeoutSeconds: 10,
  }),
)

// Background sync for outbox
self.addEventListener("sync", (event) => {
  if (event.tag === "outbox-sync") {
    event.waitUntil(processOutbox())
  }
})

// Handle offline navigation
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")))
  }
})
```

**4.2 Configure Vite for service worker (`vite.config.ts`)**

```typescript
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.(?:png|jpg|jpeg|svg|gif)$/,
            handler: "CacheFirst",
          },
        ],
      },
      manifest: {
        name: "Threa",
        short_name: "Threa",
        description: "Team communication app",
        theme_color: "#6366f1",
        background_color: "#18181b",
        display: "standalone",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
})
```

### Phase 5: UI Indicators

**5.1 Offline banner component**

```typescript
export function OfflineBanner() {
  const { isOnline, pendingMessageCount, retryPending } = useOffline()

  if (isOnline && pendingMessageCount === 0) return null

  return (
    <div className="offline-banner">
      {!isOnline && (
        <span>You're offline. Messages will be sent when you reconnect.</span>
      )}
      {isOnline && pendingMessageCount > 0 && (
        <>
          <span>{pendingMessageCount} message(s) pending</span>
          <button onClick={retryPending}>Retry now</button>
        </>
      )}
    </div>
  )
}
```

**5.2 Pending message indicator in MessageList**

Show outbox messages with "sending..." or "failed to send" status inline in the message list.

**5.3 Draft indicator in ChatInput**

Show "Draft saved" indicator after auto-save.

### Phase 6: Background Sync

**6.1 Implement sync coordination**

```typescript
export class SyncManager {
  // Register for background sync (when coming online)
  async registerSync(): Promise<void> {
    const registration = await navigator.serviceWorker.ready
    await registration.sync.register("outbox-sync")
  }

  // Manual sync (user action or periodic)
  async syncNow(): Promise<SyncResult>

  // Refresh streams (fetch new messages for cached streams)
  async refreshStreams(): Promise<void>
}
```

**6.2 On reconnection flow**

1. Detect online state
2. Process outbox (send pending messages)
3. Refresh open stream (fetch new events)
4. Update unread counts via WebSocket reconnection
5. Merge any events received while offline

## Dependencies to Add

```json
{
  "dependencies": {
    "idb": "^8.0.0" // Better IndexedDB wrapper (optional, can use raw IDB)
  },
  "devDependencies": {
    "vite-plugin-pwa": "^0.21.0",
    "workbox-core": "^7.3.0",
    "workbox-precaching": "^7.3.0",
    "workbox-routing": "^7.3.0",
    "workbox-strategies": "^7.3.0"
  }
}
```

## Migration Strategy

1. **Non-breaking**: All offline features are additive
2. **Graceful degradation**: If IndexedDB unavailable, app works as before
3. **Progressive enhancement**: Service worker is optional, registered only if supported

## Testing Strategy

1. **Unit tests**: IndexedDB operations with fake-indexeddb
2. **Integration tests**: useStream with mocked connectivity
3. **E2E tests**: Chrome DevTools network throttling / offline mode
4. **Manual testing**: Airplane mode scenarios

## Cache Management

- **Max cache size**: ~50MB (configurable)
- **Max events per stream**: 500 (configurable)
- **Max draft age**: 30 days
- **Pruning**: On app start, remove old/excess entries

## Security Considerations

1. **Cache encryption**: Not implemented (browser handles storage security)
2. **Clear on logout**: Wipe IndexedDB on user logout
3. **No sensitive data in SW**: API tokens stay in HTTP-only cookies

## Future Enhancements

1. **Push notifications**: Notify user of new messages while offline
2. **Periodic background sync**: Refresh cache periodically
3. **Conflict resolution**: Handle edit conflicts for offline edits
4. **Attachment caching**: Cache images and files

---

## Implementation Order

1. **IndexedDB setup** - Foundation for all offline features
2. **Draft persistence** - Quick win, high user value
3. **Message caching** - Core offline viewing
4. **Outbox system** - Offline sending
5. **Connectivity detection** - UI feedback
6. **Service worker** - Asset caching, background sync
7. **PWA manifest** - Installable app
8. **UI polish** - Indicators, transitions
