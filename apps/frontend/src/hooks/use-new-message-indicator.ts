import { useState, useEffect, useRef } from "react"
import type { StreamEvent } from "@threa/types"

/**
 * Tracks messages that arrive via socket while the stream is open,
 * from users other than the current user. Returns a set of event IDs
 * that should briefly display a "new message" visual indicator.
 *
 * Each ID auto-expires after the CSS animation completes (~2s).
 *
 * Derives its boundary from `lastReadEventId` — the same server-tracked
 * read state that drives the sidebar unread indicator and the "--- New ---"
 * divider. Events at or before this boundary are read and never flash.
 * Events after it that were already present when the stream opened get the
 * divider instead (handled by useUnreadDivider). Only events that arrive
 * via socket while viewing AND are after the read boundary flash here.
 */
export function useNewMessageIndicator(
  events: StreamEvent[],
  currentUserId: string | undefined,
  streamId: string,
  lastReadEventId?: string | null
): Set<string> {
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  /** Event IDs that were present when the stream was opened — these get the
   *  divider treatment, not the flash, even if they're after lastReadEventId. */
  const knownEventIdsRef = useRef<Set<string> | null>(null)
  const trackedIdsRef = useRef<Set<string>>(new Set())
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  // Reset on stream change + cleanup on unmount
  useEffect(() => {
    knownEventIdsRef.current = null
    trackedIdsRef.current = new Set()
    setNewIds(new Set())
    for (const t of timersRef.current) clearTimeout(t)
    timersRef.current = new Set()

    return () => {
      for (const t of timersRef.current) clearTimeout(t)
    }
  }, [streamId])

  useEffect(() => {
    if (events.length === 0) return
    if (currentUserId === undefined) return

    // First render with events: snapshot all current event IDs as "known".
    // Nothing flashes — these were already present when the stream opened.
    // Unread events among them are handled by the "--- New ---" divider.
    if (knownEventIdsRef.current === null) {
      knownEventIdsRef.current = new Set(events.map((e) => e.id))
      return
    }

    // Read boundary: events at or before lastReadEventId are read.
    // -1 means lastReadEventId isn't in the visible events — fall back to
    // the known-IDs set only.
    const lastReadIndex = lastReadEventId ? events.findIndex((e) => e.id === lastReadEventId) : -1

    // Walk backwards from newest to find genuinely new socket events.
    const freshIds: string[] = []
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      // Hard guard: events at or before the server-tracked read boundary
      // are definitively read — never flash, regardless of client state.
      if (lastReadIndex >= 0 && i <= lastReadIndex) break
      // Events that were in the timeline when we opened the stream get
      // the divider, not the flash.
      if (knownEventIdsRef.current.has(event.id)) break
      if (
        !trackedIdsRef.current.has(event.id) &&
        event.actorId !== currentUserId &&
        event.actorType === "user" &&
        (event.eventType === "message_created" || event.eventType === "companion_response")
      ) {
        freshIds.push(event.id)
      }
      knownEventIdsRef.current.add(event.id)
    }

    if (freshIds.length === 0) return

    for (const id of freshIds) trackedIdsRef.current.add(id)

    setNewIds((prev) => {
      const next = new Set(prev)
      for (const id of freshIds) next.add(id)
      return next
    })

    // Auto-expire after the animation completes
    const timer = setTimeout(() => {
      timersRef.current.delete(timer)
      for (const id of freshIds) trackedIdsRef.current.delete(id)
      setNewIds((prev) => {
        const next = new Set(prev)
        for (const id of freshIds) next.delete(id)
        return next
      })
    }, 2000)
    timersRef.current.add(timer)
  }, [events, currentUserId, lastReadEventId])

  return newIds
}
