import { useEffect, useRef, useState } from "react"
import { useUnreadCounts } from "./use-unread-counts"
import { useActivityCounts } from "./use-activity-counts"
import { SW_MSG_CLEAR_NOTIFICATIONS } from "../lib/sw-messages"

interface UseAutoMarkAsReadOptions {
  enabled?: boolean
  debounceMs?: number
}

function getIsPageActive(): boolean {
  if (typeof document === "undefined") return false
  return document.visibilityState === "visible" && document.hasFocus()
}

function usePageActive(): boolean {
  const [isPageActive, setIsPageActive] = useState(getIsPageActive)

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return

    const updateIsPageActive = () => {
      setIsPageActive(getIsPageActive())
    }

    updateIsPageActive()

    window.addEventListener("focus", updateIsPageActive)
    window.addEventListener("blur", updateIsPageActive)
    document.addEventListener("visibilitychange", updateIsPageActive)

    return () => {
      window.removeEventListener("focus", updateIsPageActive)
      window.removeEventListener("blur", updateIsPageActive)
      document.removeEventListener("visibilitychange", updateIsPageActive)
    }
  }, [])

  return isPageActive
}

/**
 * Hook that automatically marks a stream as read when viewing it.
 * Debounces the mark-as-read call to avoid excessive API calls when rapidly switching streams.
 *
 * Checks unread counts, mention counts, AND activity counts — the mark-as-read API
 * clears all of these, so this must fire when any is elevated (e.g., activity arrives
 * via the outbox handler while viewing the stream).
 */
export function useAutoMarkAsRead(
  workspaceId: string,
  streamId: string,
  lastEventId: string | undefined,
  options: UseAutoMarkAsReadOptions = {}
) {
  const { enabled = true, debounceMs = 500 } = options
  const { markAsRead, getUnreadCount } = useUnreadCounts(workspaceId)
  const { getActivityCount } = useActivityCounts(workspaceId)
  const isPageActive = usePageActive()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastMarkedRef = useRef<string | null>(null)

  // Use refs to avoid stale closure in setTimeout callback
  const streamIdRef = useRef(streamId)
  const lastEventIdRef = useRef(lastEventId)
  streamIdRef.current = streamId
  lastEventIdRef.current = lastEventId

  useEffect(() => {
    if (!enabled || !lastEventId || !isPageActive) return

    const unreadCount = getUnreadCount(streamId)
    const activityCount = getActivityCount(streamId)

    // Skip if nothing to clear
    if (unreadCount === 0 && activityCount === 0) return

    // Skip if already marked this event AND no pending activities to clear.
    // Activities can arrive via activity:created while we're viewing the stream
    // (the outbox handler is async), so we must re-fire markAsRead to clear
    // them even if lastEventId hasn't changed.
    if (lastMarkedRef.current === lastEventId && activityCount === 0) return

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
        // Dismiss any push notification for this stream — the user is reading it
        navigator.serviceWorker?.controller?.postMessage({
          type: SW_MSG_CLEAR_NOTIFICATIONS,
          streamId: currentStreamId,
        })
      }
    }, debounceMs)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [enabled, streamId, lastEventId, debounceMs, markAsRead, getUnreadCount, getActivityCount, isPageActive])
}
