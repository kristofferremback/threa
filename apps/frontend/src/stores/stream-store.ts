import Dexie from "dexie"
import { useLiveQuery } from "dexie-react-hooks"
import { db, type CachedEvent, type CachedStream } from "@/db"

/**
 * Cap the number of events loaded from IDB per stream to prevent OOM on
 * mobile devices with large conversation histories. The display-floor
 * windowing in useEvents provides further filtering on top of this.
 */
const MAX_IDB_EVENTS_PER_STREAM = 500

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
    // Use the compound index to load only the most recent events, avoiding
    // OOM on mobile for streams with very large cached histories.
    const events = await db.events
      .where("[streamId+sequence]")
      .between([streamId, Dexie.minKey], [streamId, Dexie.maxKey])
      .reverse()
      .limit(MAX_IDB_EVENTS_PER_STREAM)
      .toArray()
    // Also include any pending/failed optimistic events that may have
    // placeholder sequences outside the loaded window.
    const optimistic = await db.events
      .where("streamId")
      .equals(streamId)
      .filter((e) => e._status === "pending" || e._status === "failed")
      .toArray()
    if (optimistic.length > 0) {
      const loadedIds = new Set(events.map((e) => e.id))
      for (const e of optimistic) {
        if (!loadedIds.has(e.id)) events.push(e)
      }
    }
    return sortBySequence(events)
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
