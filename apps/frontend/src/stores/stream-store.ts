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

/**
 * Reactively read all events for a stream from IndexedDB.
 * Returns an empty array while the initial IDB read resolves.
 * Updates automatically when any write to db.events affects this stream.
 */
export function useStreamEvents(streamId: string | undefined): CachedEvent[] {
  return (
    useLiveQuery(
      async () => {
        if (!streamId) return []
        const events = await db.events.where("streamId").equals(streamId).toArray()
        return sortBySequence(events)
      },
      [streamId],
      [] as CachedEvent[]
    ) ?? []
  )
}

/**
 * Reactively read a single stream from IndexedDB.
 */
export function useStreamFromStore(streamId: string | undefined): CachedStream | undefined {
  return useLiveQuery(() => (streamId ? db.streams.get(streamId) : undefined), [streamId], undefined)
}

/**
 * Reactively read the latest (highest) sequence number for a stream.
 * Uses BigInt comparison — Dexie's sortBy uses lexicographic order
 * which is wrong for numeric sequences ("9" > "10" lexicographically).
 */
export function useLatestSequence(streamId: string | undefined): string {
  const result = useLiveQuery(
    async () => {
      if (!streamId) return "0"
      const events = await db.events.where("streamId").equals(streamId).toArray()
      if (events.length === 0) return "0"
      let max = BigInt(events[0].sequence)
      let maxStr = events[0].sequence
      for (let i = 1; i < events.length; i++) {
        const seq = BigInt(events[i].sequence)
        if (seq > max) {
          max = seq
          maxStr = events[i].sequence
        }
      }
      return maxStr
    },
    [streamId],
    "0"
  )
  return result ?? "0"
}
