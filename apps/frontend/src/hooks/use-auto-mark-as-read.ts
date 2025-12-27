import { useEffect, useRef } from "react"
import { useUnreadCounts } from "./use-unread-counts"

interface UseAutoMarkAsReadOptions {
  enabled?: boolean
  debounceMs?: number
}

/**
 * Hook that automatically marks a stream as read when viewing it.
 * Debounces the mark-as-read call to avoid excessive API calls when rapidly switching streams.
 */
export function useAutoMarkAsRead(
  workspaceId: string,
  streamId: string,
  lastEventId: string | undefined,
  options: UseAutoMarkAsReadOptions = {}
) {
  const { enabled = true, debounceMs = 500 } = options
  const { markAsRead, getUnreadCount } = useUnreadCounts(workspaceId)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastMarkedRef = useRef<string | null>(null)

  // Use refs to avoid stale closure in setTimeout callback
  const streamIdRef = useRef(streamId)
  const lastEventIdRef = useRef(lastEventId)
  streamIdRef.current = streamId
  lastEventIdRef.current = lastEventId

  useEffect(() => {
    if (!enabled || !lastEventId) return

    // Skip if already marked up to this event
    if (lastMarkedRef.current === lastEventId) return

    // Skip if no unreads for this stream
    const unreadCount = getUnreadCount(streamId)
    if (unreadCount === 0) return

    // Clear any pending timer
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    timerRef.current = setTimeout(() => {
      // Use refs to get current values at execution time, not capture time
      const currentStreamId = streamIdRef.current
      const currentLastEventId = lastEventIdRef.current
      if (currentLastEventId) {
        markAsRead(currentStreamId, currentLastEventId)
        lastMarkedRef.current = currentLastEventId
      }
    }, debounceMs)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [enabled, streamId, lastEventId, debounceMs, markAsRead, getUnreadCount])
}
