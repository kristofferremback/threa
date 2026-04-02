import { useRef, useState, useEffect, useLayoutEffect, useCallback, type RefObject } from "react"
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual"
import { EVENT_PAGE_SIZE, SCROLL_FETCH_RATIO } from "@/lib/constants"

/**
 * Default estimated item height. This only matters for the hidden settle phase —
 * items are invisible until measured, so the exact estimate just affects how many
 * items the virtualizer renders in the first pass (overscan calculations).
 */
const DEFAULT_ESTIMATE = 120
/** Items from the bottom before showing "Jump to latest" */
const JUMP_TO_LATEST_ITEM_THRESHOLD = 10
/** Grace period (ms) after programmatic scroll to avoid false auto-scroll disabling */
const PROGRAMMATIC_SCROLL_GRACE_MS = 150
/**
 * Maximum duration (ms) for the settle phase after initial load.
 * During this window, items are hidden (visibility: hidden) and scroll is
 * continuously adjusted to the bottom as ResizeObserver measurements arrive.
 * The phase ends early if scrollHeight stabilizes (no changes for 150ms).
 */
const SETTLE_MAX_MS = 1000
/** If scrollHeight doesn't change for this long during settle, we're done early. */
const SETTLE_STABLE_MS = 150

interface UseVirtualizedScrollOptions {
  /** Whether data is currently loading (delays initial scroll) */
  isLoading: boolean
  /** Total item count */
  itemCount: number
  /** Stable key for each item (event ID, session ID, etc.) */
  getItemKey: (index: number) => string
  /** Estimated item height (default: 120px) */
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
  /** Skip the settle phase (e.g. when jumping to a specific message via deep link) */
  skipSettle?: boolean
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
  /**
   * True during the initial measurement settle phase. Items are rendered with
   * visibility:hidden so ResizeObserver can measure them without showing the
   * layout dance. The component should show a loading skeleton while this is true.
   */
  isSettling: boolean
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
  skipSettle = false,
}: UseVirtualizedScrollOptions): UseVirtualizedScrollReturn {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)
  const [isScrolledFarFromBottom, setIsScrolledFarFromBottom] = useState(false)
  const [isSettling, setIsSettling] = useState(false)

  // Prepend stability tracking
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
    setIsScrolledFarFromBottom(false)
    setIsSettling(false)

    // Reset scroll position immediately to prevent old stream position showing
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

  // --- Initial load + prepend stability ---
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
        if (!skipSettle) {
          setIsSettling(true)
        }
        // Initial scroll — will be corrected during settle phase.
        // Skip when settle is skipped (jump-to-message handles its own scroll).
        if (el && !skipSettle) el.scrollTop = el.scrollHeight
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
      scrollToBottomImpl()
    }

    prevItemCountRef.current = itemCount
    prevFirstKeyRef.current = currentFirstKey
    prevScrollHeightRef.current = el?.scrollHeight ?? 0
  }, [isLoading, itemCount, getItemKey, isFetchingOlder, scrollToBottomImpl])

  // Track fetching state transitions
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

  // --- Settle phase ---
  // Items render with visibility:hidden. ResizeObserver measures them and the
  // virtualizer repositions. We keep scrolling to bottom and watch for
  // scrollHeight to stabilize. Once stable (or timeout), reveal items.
  useEffect(() => {
    if (!isSettling) return

    const el = scrollContainerRef.current
    if (!el) {
      setIsSettling(false)
      return
    }

    let lastScrollHeight = el.scrollHeight
    let stableTimer: ReturnType<typeof setTimeout> | null = null
    const startedAt = performance.now()

    const finish = () => {
      observer.disconnect()
      if (stableTimer) clearTimeout(stableTimer)
      if (maxTimer) clearTimeout(maxTimer)

      // Final scroll to bottom with correct measurements
      lastProgrammaticScrollAt.current = performance.now()
      el.scrollTop = el.scrollHeight
      setIsSettling(false)
    }

    const checkStability = () => {
      const newScrollHeight = el.scrollHeight
      // Keep scrolling to bottom during settle
      el.scrollTop = newScrollHeight

      if (newScrollHeight !== lastScrollHeight) {
        // Height changed — reset the stability timer
        lastScrollHeight = newScrollHeight
        if (stableTimer) clearTimeout(stableTimer)
        stableTimer = setTimeout(finish, SETTLE_STABLE_MS)
      }
    }

    // Watch the virtualizer's container for size changes (item measurements)
    const observer = new ResizeObserver(checkStability)
    // Observe all children of the scroll container (the virtualizer container
    // and any non-virtual elements like thread parent, loading indicators)
    for (const child of el.children) {
      observer.observe(child)
    }

    // Start the stability check — if nothing changes, finish quickly
    stableTimer = setTimeout(finish, SETTLE_STABLE_MS)

    // Hard timeout — don't wait forever
    const maxTimer = setTimeout(() => {
      if (performance.now() - startedAt >= SETTLE_MAX_MS) {
        finish()
      }
    }, SETTLE_MAX_MS)

    return () => {
      observer.disconnect()
      if (stableTimer) clearTimeout(stableTimer)
      if (maxTimer) clearTimeout(maxTimer)
    }
  }, [isSettling])

  // Post-settle: one final scroll after React re-renders with visibility restored.
  // The settle finish() scrolls before setIsSettling(false), but the re-render that
  // removes visibility:hidden can cause a tiny reflow shifting scrollHeight by a few px.
  const prevIsSettlingRef = useRef(false)
  useLayoutEffect(() => {
    const wasSettling = prevIsSettlingRef.current
    prevIsSettlingRef.current = isSettling
    if (wasSettling && !isSettling && shouldAutoScroll.current) {
      const el = scrollContainerRef.current
      if (el) {
        lastProgrammaticScrollAt.current = performance.now()
        el.scrollTop = el.scrollHeight
      }
    }
  }, [isSettling])

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

  // --- Scroll event handler ---
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      if (itemCount === 0) return

      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      const isNearBottom = distanceFromBottom < bottomThreshold

      const isInGracePeriod = performance.now() - lastProgrammaticScrollAt.current < PROGRAMMATIC_SCROLL_GRACE_MS
      if (isInGracePeriod) {
        if (isNearBottom) shouldAutoScroll.current = true
      } else {
        shouldAutoScroll.current = isNearBottom
      }

      if (isNearBottom) {
        isForceScrolling.current = false
      }

      if (!isForceScrolling.current) {
        const avgItemHeight = scrollHeight / itemCount
        const jumpThresholdPixels = JUMP_TO_LATEST_ITEM_THRESHOLD * avgItemHeight
        setIsScrolledFarFromBottom(distanceFromBottom > jumpThresholdPixels)
      }

      const virtualItems = virtualizer.getVirtualItems()
      if (virtualItems.length === 0) return

      const firstVisibleIndex = virtualItems[0].index
      const lastVisibleIndex = virtualItems[virtualItems.length - 1].index

      if (onScrollNearTop && firstVisibleIndex < triggerItemCount && !isFetchingOlder && !olderFetchScheduled.current) {
        const started = onScrollNearTop()
        if (started !== false) {
          olderFetchScheduled.current = true
        }
      }

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
    isSettling,
  }
}
