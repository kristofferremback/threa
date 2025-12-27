import { useState, useEffect, useRef, useMemo } from "react"
import type { StreamEvent } from "@threa/types"

interface UseUnreadDividerOptions {
  events: StreamEvent[]
  lastReadEventId: string | null | undefined
  currentUserId: string | undefined
  streamId: string
}

interface UseUnreadDividerResult {
  /** The calculated first unread event ID (for scroll-to behavior) */
  firstUnreadEventId: string | undefined
  /** The event ID where the divider should be shown, or undefined if hidden */
  dividerEventId: string | undefined
  /** Whether the divider is currently fading out */
  isFading: boolean
}

/**
 * Hook to manage the "New" unread divider display state.
 *
 * - Calculates the first unread event from another user
 * - Shows the divider for 3 seconds, then fades out over 500ms
 * - Resets when switching streams
 */
export function useUnreadDivider({
  events,
  lastReadEventId,
  currentUserId,
  streamId,
}: UseUnreadDividerOptions): UseUnreadDividerResult {
  // Calculate first unread event from another user
  const firstUnreadEventId = useMemo(() => {
    if (events.length === 0) return undefined

    // Find events after lastReadEventId that are from other users
    const startIndex = lastReadEventId ? events.findIndex((e) => e.id === lastReadEventId) + 1 : 0

    if (startIndex <= 0 && lastReadEventId) {
      // lastReadEventId not found in events - can't determine first unread
      return undefined
    }

    // Find first event from another user after the last read position
    for (let i = startIndex; i < events.length; i++) {
      if (events[i].actorId !== currentUserId) {
        return events[i].id
      }
    }

    return undefined
  }, [events, lastReadEventId, currentUserId])

  // Track displayed divider separately - shows for 3 seconds then fades out
  const [displayedUnreadId, setDisplayedUnreadId] = useState<string | undefined>(undefined)
  const [isFading, setIsFading] = useState(false)
  const hasShownDivider = useRef(false)

  useEffect(() => {
    // Show divider when we have a firstUnreadEventId and haven't shown one yet
    if (firstUnreadEventId && !hasShownDivider.current) {
      setDisplayedUnreadId(firstUnreadEventId)
      setIsFading(false)
      hasShownDivider.current = true

      // Start fade after 3 seconds
      const fadeTimer = setTimeout(() => {
        setIsFading(true)
      }, 3000)

      // Remove after fade completes (500ms transition)
      const removeTimer = setTimeout(() => {
        setDisplayedUnreadId(undefined)
        setIsFading(false)
      }, 3500)

      return () => {
        clearTimeout(fadeTimer)
        clearTimeout(removeTimer)
      }
    }
  }, [firstUnreadEventId])

  // Reset when stream changes
  useEffect(() => {
    hasShownDivider.current = false
    setDisplayedUnreadId(undefined)
    setIsFading(false)
  }, [streamId])

  return {
    firstUnreadEventId,
    dividerEventId: displayedUnreadId,
    isFading,
  }
}
