import { useState, useEffect, useRef } from "react"
import type { StreamEvent } from "@threa/types"

/**
 * Tracks messages that arrive via socket while the stream is open,
 * from users other than the current user. Returns a set of event IDs
 * that should briefly display a "new message" visual indicator.
 *
 * Each ID auto-expires after the CSS animation completes (~2s).
 *
 * `bootstrapMaxSequence` prevents bootstrap events from being mistaken
 * for live arrivals: the baseline is always at least as high as the
 * bootstrap's newest event, so only events that arrive *after*
 * bootstrap (via socket) can trigger the flash.
 */
export function useNewMessageIndicator(
  events: StreamEvent[],
  currentUserId: string | undefined,
  streamId: string,
  bootstrapMaxSequence?: string | null
): Set<string> {
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const baselineSequenceRef = useRef<string | null>(null)
  const trackedIdsRef = useRef<Set<string>>(new Set())
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  // Reset on stream change + cleanup on unmount
  useEffect(() => {
    baselineSequenceRef.current = null
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

    const maxSequence = events[events.length - 1].sequence

    // First render with events: snapshot baseline, don't flag anything.
    // Use bootstrapMaxSequence when available so the baseline starts at
    // the bootstrap ceiling instead of the (potentially stale) IDB ceiling.
    if (baselineSequenceRef.current === null) {
      baselineSequenceRef.current =
        bootstrapMaxSequence && BigInt(bootstrapMaxSequence) > BigInt(maxSequence) ? bootstrapMaxSequence : maxSequence
      return
    }

    // If the bootstrap arrived after the baseline was set (IDB loaded first),
    // advance the baseline so bootstrap events don't flash.
    if (bootstrapMaxSequence && BigInt(bootstrapMaxSequence) > BigInt(baselineSequenceRef.current)) {
      baselineSequenceRef.current = bootstrapMaxSequence
    }

    const baseline = baselineSequenceRef.current
    const freshIds: string[] = []

    // Walk backwards from newest; stop once we pass the baseline
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (BigInt(event.sequence) <= BigInt(baseline)) break
      if (
        event.actorId !== currentUserId &&
        event.actorType === "user" &&
        (event.eventType === "message_created" || event.eventType === "companion_response") &&
        !trackedIdsRef.current.has(event.id)
      ) {
        freshIds.push(event.id)
      }
    }

    baselineSequenceRef.current = maxSequence > baseline ? maxSequence : baseline

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
  }, [events, currentUserId, bootstrapMaxSequence])

  return newIds
}
