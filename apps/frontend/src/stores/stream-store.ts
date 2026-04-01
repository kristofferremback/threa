import Dexie from "dexie"
import { useLiveQuery } from "dexie-react-hooks"
import { db, type CachedEvent, type CachedStream } from "@/db"

/**
 * Cap the number of events loaded from IDB per stream to prevent OOM on
 * mobile devices with large conversation histories. The display-floor
 * windowing in useEvents provides further filtering on top of this.
 */
const MAX_IDB_EVENTS_PER_STREAM = 500

/** No-op — the in-memory event cache has been removed. Kept for clearAllCachedData compat. */
export function resetStreamStoreCache(): void {}

/**
 * Reactively read all events for a stream from IndexedDB.
 * Returns `undefined` while the query is resolving, `CachedEvent[]` once resolved.
 * Updates automatically when any write to db.events affects this stream.
 *
 * Guard: when `streamId` changes, `useLiveQuery` returns the previous stream's
 * events for one render (its internal useState hasn't been updated by the new
 * useEffect subscription yet). We detect this by comparing the first event's
 * streamId against the requested one, returning `undefined` to signal loading
 * and prevent stale content from flashing during stream switches.
 */
export function useStreamEvents(streamId: string | undefined): CachedEvent[] | undefined {
  const result = useLiveQuery(async () => {
    if (!streamId) return []
    // Use the numeric [streamId+_sequenceNum] index so IDB returns
    // events in correct numeric order. .reverse().limit() efficiently
    // fetches only the most recent N events without loading all into JS.
    const events = await db.events
      .where("[streamId+_sequenceNum]")
      .between([streamId, Dexie.minKey], [streamId, Dexie.maxKey])
      .reverse()
      .limit(MAX_IDB_EVENTS_PER_STREAM)
      .toArray()
    // Include any pending/failed optimistic events that may have
    // placeholder sequences outside the loaded window.
    const loadedIds = new Set(events.map((e) => e.id))
    const unsent = await db.events
      .where("streamId")
      .equals(streamId)
      .filter((e) => (e._status === "pending" || e._status === "failed") && !loadedIds.has(e.id))
      .toArray()
    for (const e of unsent) events.push(e)
    // Already sorted descending from .reverse(); flip to ascending
    events.reverse()
    return events
  }, [streamId])

  if (result && result.length > 0 && streamId && result[0].streamId !== streamId) {
    return undefined
  }

  return result
}

/**
 * Reactively read a single stream from IndexedDB.
 */
export function useStreamFromStore(streamId: string | undefined): CachedStream | undefined {
  return useLiveQuery(() => (streamId ? db.streams.get(streamId) : undefined), [streamId], undefined)
}
