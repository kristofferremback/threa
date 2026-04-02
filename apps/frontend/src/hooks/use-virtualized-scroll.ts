import { useRef, useState, useEffect, useLayoutEffect, useCallback, type RefObject } from "react"
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual"
import { EVENT_PAGE_SIZE, SCROLL_FETCH_RATIO } from "@/lib/constants"

/**
 * Default estimated item height. Overestimating is better than underestimating:
 * underestimate → items overlap on first render before measurement completes.
 * Real messages with avatar + name + content are ~120-200px.
 */
const DEFAULT_ESTIMATE = 140
/** Items from the bottom before showing "Jump to latest" */
const JUMP_TO_LATEST_ITEM_THRESHOLD = 10
/** Grace period (ms) after programmatic scroll to avoid false auto-scroll disabling */
const PROGRAMMATIC_SCROLL_GRACE_MS = 150
/**
 * Duration (ms) after initial load during which we keep re-scrolling to bottom
 * as item measurements settle. Prevents the "near bottom but not at bottom" issue
 * when estimated sizes differ from measured sizes.
 */
const SETTLE_SCROLL_DURATION_MS = 800

interface UseVirtualizedScrollOptions {
  /** Whether data is currently loading (delays initial scroll) */
  isLoading: boolean
  /** Total item count */
  itemCount: number
  /** Stable key for each item (event ID, session ID, etc.) */
  getItemKey: (index: number) => string
  /** Estimated item height (default: 140px) */
  estimateSize?: (index: number) => number
  /** Extra items rendered above/below viewport (default: 15) */
  overscan?: number
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
  /** Pixel offset for content above the virtual list (e.g. thread parent message) */
  scrollMargin?: number
}

interface UseVirtualizedScrollReturn {
  /** Ref to attach to the scrollable container */
  scrollContainerRef: RefObject<HTMLDivElement | null>
  /** The virtualizer instance */
  virtualizer: Virtualizer<HTMLDivElement, Element>
  /** True when scrolled ~10+ items away from the bottom */
  isScrolledFarFromBottom: boolean
  /** Imperatively scroll to the bottom and clear the jump-to-latest state */
  scrollToBottom: (options?: { behavior?: "auto" | "smooth"; force?: boolean }) => void
  /** Disable auto-scroll (e.g. when navigating to a specific message via jump mode) */
  disableAutoScroll: () => void
}

export function useVirtualizedScroll({
  isLoading,
  itemCount,
  getItemKey,
  estimateSize,
  overscan = 15,
  onScrollNearTop,
  onScrollNearBottom,
  isFetchingOlder = false,
  isFetchingNewer = false,
  bottomThreshold = 100,
  triggerItemCount = Math.floor(EVENT_PAGE_SIZE * SCROLL_FETCH_RATIO),
  resetKey,
  scrollMargin = 0,
}: UseVirtualizedScrollOptions): UseVirtualizedScrollReturn {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)
  const [isScrolledFarFromBottom, setIsScrolledFarFromBottom] = useState(false)

  // Prepend stability tracking — uses scrollHeight (DOM) not virtualizer.getTotalSize()
  // to avoid infinite render loops (getTotalSize triggers measurements → onChange → re-render)
  const prevItemCountRef = useRef(0)
  const prevFirstKeyRef = useRef<string | null>(null)
  const prevScrollHeightRef = useRef(0)

  // Fetch guards
  const prevIsFetchingOlder = useRef(false)
  const prevIsFetchingNewer = useRef(false)
  const olderFetchScheduled = useRef(false)
  const newerFetchScheduled = useRef(false)

  // Force-scroll and programmatic scroll tracking
  const isForceScrolling = useRef(false)
  const lastProgrammaticScrollAt = useRef(0)

  // Whether initial scroll-to-bottom has been performed for this stream
  const initialScrollDone = useRef(false)

  // Timestamp of initial load — used for settle-scrolling window
  const initialLoadAt = useRef(0)

  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: estimateSize ?? (() => DEFAULT_ESTIMATE),
    overscan,
    getItemKey,
    scrollMargin,
  })

  // Reset all state when stream changes
  useLayoutEffect(() => {
    shouldAutoScroll.current = true
    prevItemCountRef.current = 0
    prevFirstKeyRef.current = null
    prevScrollHeightRef.current = 0
    prevIsFetchingOlder.current = false
    prevIsFetchingNewer.current = false
    olderFetchScheduled.current = false
    newerFetchScheduled.current = false
    lastProgrammaticScrollAt.current = 0
    initialScrollDone.current = false
    initialLoadAt.current = 0
    setIsScrolledFarFromBottom(false)

    // Reset scroll position immediately on stream switch to prevent
    // the old stream's scroll position from being visible for one frame
    const el = scrollContainerRef.current
    if (el) el.scrollTop = 0
  }, [resetKey])

  const scrollToBottomImpl = useCallback(
    (options?: { behavior?: "auto" | "smooth"; force?: boolean }) => {
      if (!options?.force && !shouldAutoScroll.current) return
      if (itemCount === 0) return

      shouldAutoScroll.current = true
      lastProgrammaticScrollAt.current = performance.now()

      if (options?.force) {
        isForceScrolling.current = true
        setIsScrolledFarFromBottom(false)
      }

      const el = scrollContainerRef.current
      if (options?.behavior === "smooth") {
        virtualizer.scrollToIndex(itemCount - 1, {
          align: "end",
          behavior: "smooth",
        })
      } else if (el) {
        el.scrollTop = el.scrollHeight
      }
    },
    [virtualizer, itemCount]
  )

  // --- Prepend stability + initial scroll ---
  useLayoutEffect(() => {
    if (isLoading || itemCount === 0) return

    const el = scrollContainerRef.current
    const prevCount = prevItemCountRef.current
    const prevFirstKey = prevFirstKeyRef.current
    const currentFirstKey = itemCount > 0 ? getItemKey(0) : null

    // Detect initial load
    if (prevCount === 0 && itemCount > 0) {
      prevItemCountRef.current = itemCount
      prevFirstKeyRef.current = currentFirstKey
      prevScrollHeightRef.current = el?.scrollHeight ?? 0
      if (!initialScrollDone.current) {
        initialScrollDone.current = true
        initialLoadAt.current = performance.now()
        scrollToBottomImpl()
      }
      return
    }

    // Detect prepend: item count grew and the first key changed
    const olderContentJustArrived = prevIsFetchingOlder.current && !isFetchingOlder
    if (
      itemCount > prevCount &&
      currentFirstKey !== prevFirstKey &&
      prevFirstKey !== null &&
      !shouldAutoScroll.current &&
      olderContentJustArrived
    ) {
      if (el) {
        const delta = el.scrollHeight - prevScrollHeightRef.current
        if (delta > 0) {
          el.scrollTop += delta
        }
      }
    } else if (shouldAutoScroll.current && itemCount > prevCount) {
      // New content appended at bottom — auto-scroll to latest
      scrollToBottomImpl()
    }

    prevItemCountRef.current = itemCount
    prevFirstKeyRef.current = currentFirstKey
    prevScrollHeightRef.current = el?.scrollHeight ?? 0
  }, [isLoading, itemCount, getItemKey, isFetchingOlder, scrollToBottomImpl])

  // Track fetching state transitions (reset one-shot guards)
  useLayoutEffect(() => {
    if (prevIsFetchingOlder.current && !isFetchingOlder) olderFetchScheduled.current = false
    if (prevIsFetchingNewer.current && !isFetchingNewer) newerFetchScheduled.current = false
    prevIsFetchingOlder.current = isFetchingOlder
    prevIsFetchingNewer.current = isFetchingNewer
    const el = scrollContainerRef.current
    if (el) {
      prevScrollHeightRef.current = el.scrollHeight
    }
  })

  // --- Settle scroll ---
  // After initial load, item measurements arrive asynchronously via ResizeObserver.
  // Each measurement changes scrollHeight. Watch for these changes and re-scroll
  // to bottom during a brief settle window, so the user always sees the latest message.
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el || !initialScrollDone.current) return

    const observer = new ResizeObserver(() => {
      if (!shouldAutoScroll.current) return

      // Only re-scroll during the settle window after initial load
      const elapsed = performance.now() - initialLoadAt.current
      if (elapsed > SETTLE_SCROLL_DURATION_MS) {
        observer.disconnect()
        return
      }

      lastProgrammaticScrollAt.current = performance.now()
      el.scrollTop = el.scrollHeight
    })

    // Observe the scroll container's first child (the virtualizer's sized container)
    // — its height changes as items are measured
    const inner = el.firstElementChild
    if (inner) {
      observer.observe(inner)
    }

    // Self-clean after settle window
    const timer = setTimeout(() => observer.disconnect(), SETTLE_SCROLL_DURATION_MS)

    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [resetKey, isLoading, itemCount])

  // Auto-scroll to bottom when the container shrinks (e.g. mobile keyboard opens)
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

  // --- Scroll event handler (fetch triggers + auto-scroll tracking) ---
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      if (itemCount === 0) return

      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      const isNearBottom = distanceFromBottom < bottomThreshold

      // Grace period after programmatic scroll
      const isInGracePeriod = performance.now() - lastProgrammaticScrollAt.current < PROGRAMMATIC_SCROLL_GRACE_MS
      if (isInGracePeriod) {
        if (isNearBottom) shouldAutoScroll.current = true
      } else {
        shouldAutoScroll.current = isNearBottom
      }

      if (isNearBottom) {
        isForceScrolling.current = false
      }

      // Jump-to-latest visibility
      if (!isForceScrolling.current) {
        const avgItemHeight = scrollHeight / itemCount
        const jumpThresholdPixels = JUMP_TO_LATEST_ITEM_THRESHOLD * avgItemHeight
        setIsScrolledFarFromBottom(distanceFromBottom > jumpThresholdPixels)
      }

      // Fetch triggers based on virtual item range
      const virtualItems = virtualizer.getVirtualItems()
      if (virtualItems.length === 0) return

      const firstVisibleIndex = virtualItems[0].index
      const lastVisibleIndex = virtualItems[virtualItems.length - 1].index

      // Load older when near top
      if (onScrollNearTop && firstVisibleIndex < triggerItemCount && !isFetchingOlder && !olderFetchScheduled.current) {
        const started = onScrollNearTop()
        if (started !== false) {
          olderFetchScheduled.current = true
        }
      }

      // Load newer when near bottom (jump mode)
      if (
        onScrollNearBottom &&
        !isFetchingNewer &&
        !newerFetchScheduled.current &&
        itemCount - lastVisibleIndex < triggerItemCount
      ) {
        const started = onScrollNearBottom()
        if (started !== false) {
          newerFetchScheduled.current = true
        }
      }
    }

    el.addEventListener("scroll", handleScroll, { passive: true })
    return () => el.removeEventListener("scroll", handleScroll)
  }, [
    virtualizer,
    onScrollNearTop,
    onScrollNearBottom,
    isFetchingOlder,
    isFetchingNewer,
    bottomThreshold,
    itemCount,
    triggerItemCount,
  ])

  const disableAutoScroll = useCallback(() => {
    shouldAutoScroll.current = false
  }, [])

  return {
    scrollContainerRef,
    virtualizer,
    isScrolledFarFromBottom,
    scrollToBottom: scrollToBottomImpl,
    disableAutoScroll,
  }
}
