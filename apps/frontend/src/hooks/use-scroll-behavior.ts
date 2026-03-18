import { useRef, useEffect, useCallback, type RefObject } from "react"
import { EVENT_PAGE_SIZE, SCROLL_FETCH_RATIO } from "@/lib/constants"

interface UseScrollBehaviorOptions {
  /** Whether data is currently loading (delays initial scroll) */
  isLoading: boolean
  /** Number of items in the list (triggers scroll when changes) */
  itemCount: number
  /** Called when user scrolls near the top (for loading older messages) */
  onScrollNearTop?: () => void
  /** Called when user scrolls near the bottom (for loading newer messages in jump-to mode) */
  onScrollNearBottom?: () => void
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
}

interface UseScrollBehaviorReturn {
  /** Ref to attach to the scrollable container */
  scrollContainerRef: RefObject<HTMLDivElement | null>
  /** Scroll handler to attach to the container's onScroll */
  handleScroll: () => void
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
}: UseScrollBehaviorOptions): UseScrollBehaviorReturn {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)
  const prevItemCount = useRef(0)
  const prevScrollHeight = useRef(0)

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current && shouldAutoScroll.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [])

  // Capture scroll height before DOM updates (when item count is about to change)
  // This runs synchronously before paint via useLayoutEffect-like timing in the effect below
  useEffect(() => {
    const el = scrollContainerRef.current
    if (el) {
      prevScrollHeight.current = el.scrollHeight
    }
  })

  // Scroll position preservation and initial scroll
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el || isLoading) return

    const oldCount = prevItemCount.current
    prevItemCount.current = itemCount

    if (oldCount === 0 && itemCount > 0) {
      // Initial load — scroll to bottom
      scrollToBottom()
      return
    }

    if (itemCount > oldCount && !shouldAutoScroll.current) {
      // Items were added. If the user is NOT at the bottom, preserve position.
      // New scrollHeight minus old scrollHeight = height of prepended content.
      const heightDelta = el.scrollHeight - prevScrollHeight.current
      if (heightDelta > 0 && el.scrollTop < el.scrollHeight - el.clientHeight - bottomThreshold) {
        el.scrollTop += heightDelta
      }
    } else if (shouldAutoScroll.current) {
      scrollToBottom()
    }
  }, [isLoading, itemCount, scrollToBottom, bottomThreshold])

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

    // Load older content when near top
    if (onScrollNearTop && scrollTop < triggerPixels && !isFetchingOlder) {
      onScrollNearTop()
    }

    // Load newer content when near bottom (jump-to mode)
    if (onScrollNearBottom && !isFetchingNewer) {
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      if (distanceFromBottom < triggerPixels) {
        onScrollNearBottom()
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
  }
}
