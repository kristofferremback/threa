import { useRef, useEffect, useCallback, type RefObject } from "react"

interface UseScrollBehaviorOptions {
  /** Whether data is currently loading (delays initial scroll) */
  isLoading: boolean
  /** Number of items in the list (triggers scroll when changes) */
  itemCount: number
  /** Called when user scrolls near the top (for infinite scroll) */
  onScrollNearTop?: () => void
  /** Whether infinite scroll is currently fetching */
  isFetchingMore?: boolean
  /** Threshold in pixels from top to trigger onScrollNearTop (default: 100) */
  topThreshold?: number
  /** Threshold in pixels from bottom to consider "near bottom" (default: 100) */
  bottomThreshold?: number
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
 * - Optional infinite scroll callback when scrolling near top
 */
export function useScrollBehavior({
  isLoading,
  itemCount,
  onScrollNearTop,
  isFetchingMore = false,
  topThreshold = 100,
  bottomThreshold = 100,
}: UseScrollBehaviorOptions): UseScrollBehaviorReturn {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current && shouldAutoScroll.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [])

  // Initial scroll to bottom when data loads
  useEffect(() => {
    if (!isLoading && itemCount > 0) {
      scrollToBottom()
    }
  }, [isLoading, itemCount, scrollToBottom])

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
    const isNearBottom = scrollHeight - scrollTop - clientHeight < bottomThreshold

    // Resume auto-scroll if user scrolls back to bottom
    shouldAutoScroll.current = isNearBottom

    // Infinite scroll: load older content when near top
    if (onScrollNearTop && scrollTop < topThreshold && !isFetchingMore) {
      onScrollNearTop()
    }
  }, [onScrollNearTop, isFetchingMore, topThreshold, bottomThreshold])

  return {
    scrollContainerRef,
    handleScroll,
  }
}
