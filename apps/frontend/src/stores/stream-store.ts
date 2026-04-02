import Dexie from "dexie"
import { useLiveQuery } from "dexie-react-hooks"
import { db, type CachedEvent, type CachedStream } from "@/db"

/**
 * Cap the number of events loaded from IDB per stream when no sequence floor
 * is known (initial load before bootstrap resolves). Once the caller provides
 * a floor, the IDB query switches to a range scan with no count limit —
 * the floor itself bounds memory usage.
 */
const DEFAULT_IDB_EVENT_LIMIT = 150

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
export function useStreamEvents(
  streamId: string | undefined,
  fromSequenceNum?: number | null
): CachedEvent[] | undefined {
  const result = useLiveQuery(async () => {
    if (!streamId) return []

    let events: CachedEvent[]
    if (fromSequenceNum != null) {
      // Floor-based range scan: return all events from the floor onward.
      // The floor is controlled by the caller (bootstrap + pagination) so
      // memory is bounded by how far the user has actually scrolled back.
      events = await db.events
        .where("[streamId+_sequenceNum]")
        .between([streamId, fromSequenceNum], [streamId, Dexie.maxKey], true, true)
        .toArray()
    } else {
      // No floor known yet (pre-bootstrap) — use a count-based cap so the
      // initial load is bounded on low-memory devices.
      events = await db.events
        .where("[streamId+_sequenceNum]")
        .between([streamId, Dexie.minKey], [streamId, Dexie.maxKey])
        .reverse()
        .limit(DEFAULT_IDB_EVENT_LIMIT)
        .toArray()
      events.reverse()
    }

    // Include any pending/failed optimistic events that may have
    // placeholder sequences outside the loaded window.
    const loadedIds = new Set(events.map((e) => e.id))
    const unsent = await db.events
      .where("streamId")
      .equals(streamId)
      .filter((e) => (e._status === "pending" || e._status === "failed") && !loadedIds.has(e.id))
      .toArray()
    for (const e of unsent) events.push(e)
    return events
  }, [streamId, fromSequenceNum])

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
