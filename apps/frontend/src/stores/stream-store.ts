import { useLiveQuery } from "dexie-react-hooks"
import { db, type CachedEvent, type CachedStream } from "@/db"

/**
 * Sort events by sequence (bigint comparison, not lexicographic).
 * Sequences are stored as strings but represent bigints.
 */
function sortBySequence(events: CachedEvent[]): CachedEvent[] {
  return events.sort((a, b) => {
    const seqA = BigInt(a.sequence)
    const seqB = BigInt(b.sequence)
    if (seqA < seqB) return -1
    if (seqA > seqB) return 1
    return 0
  })
}

// Per-stream event cache — populated by seedStreamEventCache (called from
// seedCacheFromIdb on mount) so that useStreamEvents returns cached events
// on the first synchronous render after the coordinated loading gate opens.
// Same pattern as the workspace in-memory cache in workspace-store.ts.
const eventCache = new Map<string, CachedEvent[]>()

function isTimelineMessageEvent(event: CachedEvent): boolean {
  return event.eventType === "message_created" || event.eventType === "companion_response"
}

export function hasStreamEventCache(streamId: string | undefined): boolean {
  return !!streamId && eventCache.has(streamId)
}

export function getCachedStreamEvents(streamId: string | undefined): CachedEvent[] {
  return streamId ? (eventCache.get(streamId) ?? []) : []
}

export function hasCachedMessageAtOrAfter(streamId: string | undefined, createdAt: string | null | undefined): boolean {
  if (!createdAt) return true

  const threshold = Date.parse(createdAt)
  if (Number.isNaN(threshold)) return true

  const cachedEvents = getCachedStreamEvents(streamId)
  return cachedEvents.some((event) => isTimelineMessageEvent(event) && Date.parse(event.createdAt) >= threshold)
}

export function resetStreamStoreCache(): void {
  eventCache.clear()
}

/**
 * Prime the event cache from IDB for all streams in a workspace.
 * Called from seedCacheFromIdb so stream events are available instantly
 * when the coordinated loading gate opens from IDB cache.
 */
export async function seedStreamEventCache(workspaceId: string, knownStreamIds: string[] = []): Promise<void> {
  for (const streamId of knownStreamIds) {
    eventCache.set(streamId, [])
  }

  const allEvents = await db.events.where("workspaceId").equals(workspaceId).toArray()
  const byStream = new Map<string, CachedEvent[]>()
  for (const e of allEvents) {
    let arr = byStream.get(e.streamId)
    if (!arr) {
      arr = []
      byStream.set(e.streamId, arr)
    }
    arr.push(e)
  }
  for (const [streamId, events] of byStream) {
    eventCache.set(streamId, sortBySequence(events))
  }
}

/**
 * Seed the event cache for a single stream. Called by applyStreamBootstrap
 * after writing events to IDB, so useStreamEvents returns data synchronously
 * when the coordinated loading gate opens.
 */
export function seedStreamEvents(streamId: string, events: CachedEvent[]): void {
  eventCache.set(streamId, sortBySequence([...events]))
}

/**
 * Append a single event to the in-memory cache for a stream.
 * Called by socket handlers alongside IDB writes so the cache stays
 * in sync without waiting for useLiveQuery to re-query.
 */
export function appendToEventCache(streamId: string, event: CachedEvent): void {
  const existing = eventCache.get(streamId)
  if (!existing) return // Stream not cached yet — useLiveQuery will pick it up
  if (existing.some((e) => e.id === event.id)) return // Dedupe
  eventCache.set(streamId, sortBySequence([...existing, event]))
}

/**
 * Reactively read all events for a stream from IndexedDB.
 * Uses per-stream cache as default so returning users see events instantly.
 * Updates automatically when any write to db.events affects this stream.
 */
export function useStreamEvents(streamId: string | undefined): CachedEvent[] {
  const cached = streamId ? (eventCache.get(streamId) ?? []) : []
  const live =
    useLiveQuery(
      async () => {
        if (!streamId) return []
        const events = await db.events.where("streamId").equals(streamId).toArray()
        return sortBySequence(events)
      },
      [streamId],
      cached
    ) ?? []

  // Update cache when liveQuery resolves, including known-empty streams.
  // Guard: don't overwrite a freshly-seeded cache with a stale empty result
  // from useLiveQuery during IDB re-query transitions. The bridge below
  // handles the return value, but without this guard the NEXT render would
  // find the cache corrupted to [] and the bridge can't save it.
  // Allow empty writes when live and cached are the same reference (the
  // default value), meaning liveQuery hasn't re-queried yet — no stale
  // overwrite risk. Also allow when live has data or cache is already empty.
  if (streamId && (live.length > 0 || cached.length === 0 || live !== cached)) {
    eventCache.set(streamId, live)
  }

  // Bridge async gap: if liveQuery returned empty but cache has data
  if (live.length === 0 && cached.length > 0) return cached
  return live
}

/**
 * Reactively read a single stream from IndexedDB.
 */
export function useStreamFromStore(streamId: string | undefined): CachedStream | undefined {
  return useLiveQuery(() => (streamId ? db.streams.get(streamId) : undefined), [streamId], undefined)
}
