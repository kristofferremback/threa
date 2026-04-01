import { useRef, useState, useEffect, useLayoutEffect, useCallback, type RefObject } from "react"
import { EVENT_PAGE_SIZE, SCROLL_FETCH_RATIO } from "@/lib/constants"

/** Number of items from the bottom before showing "Jump to latest" */
const JUMP_TO_LATEST_ITEM_THRESHOLD = 10

interface UseScrollBehaviorOptions {
  /** Whether data is currently loading (delays initial scroll) */
  isLoading: boolean
  /** Number of items in the list (triggers scroll when changes) */
  itemCount: number
  /** Called when user scrolls near the top (for loading older messages) */
  onScrollNearTop?: () => boolean
  /** Called when user scrolls near the bottom (for loading newer messages in jump-to mode) */
  onScrollNearBottom?: () => boolean
  /** Whether infinite scroll is currently fetching older events */
  isFetchingOlder?: boolean
  /** Whether infinite scroll is currently fetching newer events */
  isFetchingNewer?: boolean
  /** Threshold in pixels from bottom to consider "near bottom" for auto-scroll (default: 100) */
  bottomThreshold?: number
  /**
   * Number of items from the edge that triggers a fetch.
   * Default: EVENT_PAGE_SIZE * SCROLL_FETCH_RATIO (25)
   */
  triggerItemCount?: number
  /** When this key changes, all scroll state resets (e.g. streamId). */
  resetKey?: string
}

interface UseScrollBehaviorReturn {
  /** Ref to attach to the scrollable container */
  scrollContainerRef: RefObject<HTMLDivElement | null>
  /** Scroll handler to attach to the container's onScroll */
  handleScroll: () => void
  /** True when scrolled ~10+ items away from the bottom */
  isScrolledFarFromBottom: boolean
  /** Imperatively scroll to the bottom and clear the jump-to-latest state */
  scrollToBottom: (options?: { behavior?: ScrollBehavior; force?: boolean }) => void
}

/**
 * Hook for managing scroll behavior in chat-like interfaces.
 *
 * Features:
 * - Auto-scrolls to bottom on initial load and new messages
 * - Tracks if user has scrolled away (pauses auto-scroll)
 * - Resumes auto-scroll when user scrolls back to bottom
 * - Triggers fetch callbacks based on scroll position relative to item count
 * - Preserves scroll position when older content is prepended
 */
export function useScrollBehavior({
  isLoading,
  itemCount,
  onScrollNearTop,
  onScrollNearBottom,
  isFetchingOlder = false,
  isFetchingNewer = false,
  bottomThreshold = 100,
  triggerItemCount = Math.floor(EVENT_PAGE_SIZE * SCROLL_FETCH_RATIO),
  resetKey,
}: UseScrollBehaviorOptions): UseScrollBehaviorReturn {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)
  const [isScrolledFarFromBottom, setIsScrolledFarFromBottom] = useState(false)
  const prevItemCount = useRef(0)
  const prevScrollHeight = useRef(0)
  // Track previous-render fetching values so effects can detect true→false transitions.
  const prevIsFetchingOlder = useRef(false)
  const prevIsFetchingNewer = useRef(false)
  // One-shot guards: prevent onScrollNearTop/Bottom from firing repeatedly
  // between React re-renders while the user scrolls within the trigger zone.
  const olderFetchScheduled = useRef(false)
  const newerFetchScheduled = useRef(false)

  // Reset all scroll state when the content source changes (e.g. stream switch).
  // Without this, prevItemCount retains the old stream's count and the
  // "initial load → scroll to bottom" path never fires.
  useEffect(() => {
    shouldAutoScroll.current = true
    prevItemCount.current = 0
    prevScrollHeight.current = 0
    prevIsFetchingOlder.current = false
    prevIsFetchingNewer.current = false
    olderFetchScheduled.current = false
    newerFetchScheduled.current = false
    setIsScrolledFarFromBottom(false)
  }, [resetKey])

  const scrollToBottom = useCallback((options?: { behavior?: ScrollBehavior; force?: boolean }) => {
    const el = scrollContainerRef.current
    if (!el) return

    if (!options?.force && !shouldAutoScroll.current) {
      return
    }

    shouldAutoScroll.current = true
    // Only eagerly clear the "far from bottom" state for forced scrolls (jump
    // to latest button). Auto-scroll calls from useLayoutEffect should not
    // trigger a React state update — the next handleScroll will set it naturally.
    if (options?.force) {
      setIsScrolledFarFromBottom(false)
    }

    if (options?.behavior) {
      el.scrollTo({ top: el.scrollHeight, behavior: options.behavior })
      return
    }

    el.scrollTop = el.scrollHeight
  }, [])

  // Scroll position preservation and initial scroll.
  // useLayoutEffect runs synchronously after DOM mutation but before paint,
  // preventing a visible one-frame scroll jump when older messages are prepended.
  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el || isLoading) return

    const oldCount = prevItemCount.current
    prevItemCount.current = itemCount

    if (oldCount === 0 && itemCount > 0) {
      // Initial load — scroll to bottom
      scrollToBottom()
      return
    }

    // Only preserve scroll when older content was just prepended at the top
    // (isFetchingOlder transitioned true→false). Bottom-appended content
    // (WebSocket messages, newer pagination) needs no scrollTop adjustment.
    const olderContentJustArrived = prevIsFetchingOlder.current && !isFetchingOlder
    if (itemCount > oldCount && !shouldAutoScroll.current && olderContentJustArrived) {
      const heightDelta = el.scrollHeight - prevScrollHeight.current
      if (heightDelta > 0) {
        el.scrollTop += heightDelta
      }
    } else if (shouldAutoScroll.current) {
      scrollToBottom()
    }
  }, [isLoading, itemCount, scrollToBottom, isFetchingOlder])

  // Capture previous-render values AFTER the adjustment effect has read them.
  // No dep array → runs every render, defined after adjustment so it runs second.
  // Must also be useLayoutEffect to maintain ordering with the adjustment above.
  useLayoutEffect(() => {
    // Reset one-shot guards when fetching completes (true→false transition)
    if (prevIsFetchingOlder.current && !isFetchingOlder) olderFetchScheduled.current = false
    if (prevIsFetchingNewer.current && !isFetchingNewer) newerFetchScheduled.current = false
    prevIsFetchingOlder.current = isFetchingOlder
    prevIsFetchingNewer.current = isFetchingNewer
    const el = scrollContainerRef.current
    if (el) {
      prevScrollHeight.current = el.scrollHeight
    }
  })

  // Auto-scroll to bottom when the container shrinks (e.g. mobile keyboard opens).
  // This keeps the latest messages visible instead of being pushed off-screen.
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    let prevHeight = el.clientHeight

    const observer = new ResizeObserver(() => {
      const newHeight = el.clientHeight
      if (newHeight < prevHeight && shouldAutoScroll.current) {
        el.scrollTop = el.scrollHeight
      }
      prevHeight = newHeight
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
    const isNearBottom = scrollHeight - scrollTop - clientHeight < bottomThreshold

    // Resume auto-scroll if user scrolls back to bottom
    shouldAutoScroll.current = isNearBottom

    if (itemCount === 0) return

    // Estimate average item height and compute pixel threshold from item count
    const avgItemHeight = scrollHeight / itemCount
    const triggerPixels = triggerItemCount * avgItemHeight

    // Track whether user is scrolled far enough from bottom to show "Jump to latest"
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    const jumpThresholdPixels = JUMP_TO_LATEST_ITEM_THRESHOLD * avgItemHeight
    setIsScrolledFarFromBottom(distanceFromBottom > jumpThresholdPixels)

    // Load older content when near top (one-shot until fetch completes)
    if (onScrollNearTop && scrollTop < triggerPixels && !isFetchingOlder && !olderFetchScheduled.current) {
      const started = onScrollNearTop()
      if (started !== false) {
        olderFetchScheduled.current = true
      }
    }

    // Load newer content when near bottom (jump-to mode, one-shot)
    if (onScrollNearBottom && !isFetchingNewer && !newerFetchScheduled.current) {
      if (distanceFromBottom < triggerPixels) {
        const started = onScrollNearBottom()
        if (started !== false) {
          newerFetchScheduled.current = true
        }
      }
    }
  }, [
    onScrollNearTop,
    onScrollNearBottom,
    isFetchingOlder,
    isFetchingNewer,
    bottomThreshold,
    itemCount,
    triggerItemCount,
  ])

  return {
    scrollContainerRef,
    handleScroll,
    isScrolledFarFromBottom,
    scrollToBottom,
  }
}
