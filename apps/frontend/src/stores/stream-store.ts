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
 * Correctness: when `streamId` changes, `useLiveQuery` keeps returning the
 * previous stream's result until the new query resolves. We can't trust that
 * result even when it's empty (an empty previous-stream result would otherwise
 * be interpreted as "current stream is empty"). We track which `streamId`
 * the live result has actually been resolved for and return `undefined`
 * until the two match.
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
    for (const e of unsent)
      events.push(e)
      // Stamp the result with the streamId it was fetched for so the caller
      // can distinguish a fresh empty result from a stale empty result left
      // over from the previous stream.
    ;(events as CachedEvent[] & { __streamId?: string }).__streamId = streamId
    return events
  }, [streamId, fromSequenceNum])

  // Until `useLiveQuery` re-runs after a streamId change, `result` is still
  // the previous stream's array. Our stamp lets us detect that regardless of
  // whether the previous result happened to be non-empty or empty.
  const resultStreamId = (result as (CachedEvent[] & { __streamId?: string }) | undefined)?.__streamId
  if (streamId && resultStreamId !== streamId) {
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
