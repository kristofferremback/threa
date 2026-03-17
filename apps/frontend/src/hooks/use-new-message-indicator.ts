import { useState, useEffect, useRef } from "react"
import type { StreamEvent } from "@threa/types"

/**
 * Tracks messages that arrive via socket while the stream is open,
 * from users other than the current user. Returns a set of event IDs
 * that should briefly display a "new message" visual indicator.
 *
 * Each ID auto-expires after the CSS animation completes (~2s).
 */
export function useNewMessageIndicator(
  events: StreamEvent[],
  currentUserId: string | undefined,
  streamId: string
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

    const maxSequence = events[events.length - 1].sequence

    // First render with events: snapshot baseline, don't flag anything
    if (baselineSequenceRef.current === null) {
      baselineSequenceRef.current = maxSequence
      return
    }

    const baseline = baselineSequenceRef.current
    const freshIds: string[] = []

    // Walk backwards from newest; stop once we pass the baseline
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (BigInt(event.sequence) <= BigInt(baseline)) break
      if (
        event.actorId !== currentUserId &&
        event.eventType === "message_created" &&
        !trackedIdsRef.current.has(event.id)
      ) {
        freshIds.push(event.id)
      }
    }

    baselineSequenceRef.current = maxSequence

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
      setNewIds((prev) => {
        const next = new Set(prev)
        for (const id of freshIds) next.delete(id)
        return next
      })
    }, 2000)
    timersRef.current.add(timer)
  }, [events, currentUserId])

  return newIds
}
