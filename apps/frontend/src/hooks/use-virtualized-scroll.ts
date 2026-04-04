import { useRef, useState, useEffect, useLayoutEffect, useCallback, type RefObject } from "react"
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual"
import { EVENT_PAGE_SIZE, SCROLL_FETCH_RATIO } from "@/lib/constants"

/**
 * Default estimated item height. Only used when no custom estimateSize is provided.
 * With content-aware estimates, this is a fallback for edge cases.
 */
const DEFAULT_ESTIMATE = 120
/** Items from the bottom before showing "Jump to latest" */
const JUMP_TO_LATEST_ITEM_THRESHOLD = 10
/** Grace period (ms) after programmatic scroll to avoid false auto-scroll disabling */
const PROGRAMMATIC_SCROLL_GRACE_MS = 150
/**
 * Cooldown (ms) after a fetch completes before allowing another fetch in the
 * same direction. Prevents runaway loading caused by estimate→measurement
 * scroll drift repositioning the viewport near the edge again.
 */
const FETCH_COOLDOWN_MS = 500
/**
 * Grace period (ms) after initial load during which measurement-driven scroll
 * shifts cannot disable auto-scroll. Measurements trickle in over several
 * hundred milliseconds and can shift the viewport away from the bottom,
 * falsely disabling auto-scroll and leaving the user "stuck" a few messages
 * above the bottom with no way to recover.
 */
const RECENTLY_LOADED_GRACE_MS = 500

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
   * Default: EVENT_PAGE_SIZE * SCROLL_FETCH_RATIO (37)
   */
  triggerItemCount?: number
  /** When this key changes, all scroll state resets (e.g. streamId). */
  resetKey?: string
  /** Pixel offset for content above the virtual list (e.g. thread parent message) */
  scrollMargin?: number
  /** Virtual padding before first item (included in getTotalSize) */
  paddingStart?: number
  /** Virtual padding after last item (included in getTotalSize) */
  paddingEnd?: number
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
  paddingStart = 0,
  paddingEnd = 0,
}: UseVirtualizedScrollOptions): UseVirtualizedScrollReturn {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)
  const [isScrolledFarFromBottom, setIsScrolledFarFromBottom] = useState(false)

  // Prepend stability tracking
  const prevItemCountRef = useRef(0)
  const prevFirstKeyRef = useRef<string | null>(null)
  const prevScrollHeightRef = useRef(0)

  // Fetch guards — current refs let the scroll handler read live values
  // without needing isFetchingOlder/Newer in its dependency array
  const prevIsFetchingOlder = useRef(false)
  const prevIsFetchingNewer = useRef(false)
  const isFetchingOlderRef = useRef(isFetchingOlder)
  isFetchingOlderRef.current = isFetchingOlder
  const isFetchingNewerRef = useRef(isFetchingNewer)
  isFetchingNewerRef.current = isFetchingNewer
  const olderFetchScheduled = useRef(false)
  const newerFetchScheduled = useRef(false)

  // Per-direction cooldown: earliest time another fetch is allowed
  const olderFetchCooldownUntil = useRef(0)
  const newerFetchCooldownUntil = useRef(0)

  // Force-scroll and programmatic scroll tracking
  const isForceScrolling = useRef(false)
  const lastProgrammaticScrollAt = useRef(0)

  // Whether initial scroll-to-bottom has been performed for this stream
  const initialScrollDone = useRef(false)

  // Grace period after initial load
  const recentlyLoadedUntil = useRef(0)

  // The virtualizer auto-corrects scroll when items above the viewport
  // resize. We suppress corrections for small deltas (< 30px) to avoid
  // micro-jumps from estimate→measurement discrepancies during scroll.
  // Large deltas (e.g. images loading) still get corrected.
  // Note: shouldAdjustScrollPositionOnItemSizeChange exists in virtual-core
  // 3.13.23 but the React adapter types haven't been updated yet.
  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: estimateSize ?? (() => DEFAULT_ESTIMATE),
    overscan,
    getItemKey,
    scrollMargin,
    paddingStart,
    paddingEnd,
    useFlushSync: false,
    ...({
      shouldAdjustScrollPositionOnItemSizeChange: (_item: unknown, delta: number, _instance: unknown) =>
        Math.abs(delta) > 30,
    } as Record<string, unknown>),
  })

  // Reset all state when stream changes
  useLayoutEffect(() => {
    shouldAutoScroll.current = true
    prevItemCountRef.current = 0
    prevFirstKeyRef.current = null
    prevIsFetchingOlder.current = false
    prevIsFetchingNewer.current = false
    olderFetchScheduled.current = false
    newerFetchScheduled.current = false
    olderFetchCooldownUntil.current = 0
    newerFetchCooldownUntil.current = 0
    isForceScrolling.current = false
    lastProgrammaticScrollAt.current = 0
    initialScrollDone.current = false
    recentlyLoadedUntil.current = 0
    prevScrollHeightRef.current = 0
    setIsScrolledFarFromBottom(false)
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

      virtualizer.scrollToIndex(itemCount - 1, {
        align: "end",
        behavior: options?.behavior === "smooth" ? "smooth" : "auto",
      })
    },
    [virtualizer, itemCount]
  )

  // --- Initial load + prepend stability ---
  useLayoutEffect(() => {
    if (isLoading || itemCount === 0) return

    const prevCount = prevItemCountRef.current
    const prevFirstKey = prevFirstKeyRef.current
    const currentFirstKey = itemCount > 0 ? getItemKey(0) : null

    // Detect initial load
    if (prevCount === 0 && itemCount > 0) {
      prevItemCountRef.current = itemCount
      prevFirstKeyRef.current = currentFirstKey
      if (!initialScrollDone.current) {
        initialScrollDone.current = true
        lastProgrammaticScrollAt.current = performance.now()
        recentlyLoadedUntil.current = performance.now() + RECENTLY_LOADED_GRACE_MS
        virtualizer.scrollToIndex(itemCount - 1, { align: "end" })
      }
      return
    }

    // Detect prepend: item count grew and the first key changed.
    // The virtualizer's built-in shouldAdjustScrollPositionOnItemSizeChange
    // handles measurement-driven scroll correction, but prepends add new items
    // above the viewport which requires explicit offset correction.
    const olderContentJustArrived = prevIsFetchingOlder.current && !isFetchingOlder
    if (
      itemCount > prevCount &&
      currentFirstKey !== prevFirstKey &&
      prevFirstKey !== null &&
      !shouldAutoScroll.current &&
      olderContentJustArrived
    ) {
      // After prepend, adjust scrollTop by the height delta to keep the same
      // content in view. This preserves exact viewport position instead of
      // snapping the previously-first item to the top of the viewport.
      const el = scrollContainerRef.current
      if (el && prevScrollHeightRef.current > 0) {
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
    prevScrollHeightRef.current = scrollContainerRef.current?.scrollHeight ?? 0
  }, [isLoading, itemCount, getItemKey, isFetchingOlder, scrollToBottomImpl, virtualizer])

  // Track fetching state transitions and start cooldown timers
  useLayoutEffect(() => {
    if (prevIsFetchingOlder.current && !isFetchingOlder) {
      olderFetchScheduled.current = false
      olderFetchCooldownUntil.current = performance.now() + FETCH_COOLDOWN_MS
      prevScrollHeightRef.current = scrollContainerRef.current?.scrollHeight ?? 0
    }
    if (prevIsFetchingNewer.current && !isFetchingNewer) {
      newerFetchScheduled.current = false
      newerFetchCooldownUntil.current = performance.now() + FETCH_COOLDOWN_MS
    }
    prevIsFetchingOlder.current = isFetchingOlder
    prevIsFetchingNewer.current = isFetchingNewer
  })

  // --- Auto-scroll to bottom when container resizes (e.g. mobile keyboard) ---
  // Only scrolls when auto-scroll is active. Uses a debounce to wait for
  // the resize to finish before scrolling, preventing the flicker loop that
  // occurred when onChange + scrollToIndex fought with resize events.
  const resizeTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      if (!shouldAutoScroll.current || itemCount === 0) return
      // Debounce: wait for resize to settle before scrolling
      window.clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = window.setTimeout(() => {
        lastProgrammaticScrollAt.current = performance.now()
        virtualizer.scrollToIndex(itemCount - 1, { align: "end" })
      }, 100)
    })

    observer.observe(el)
    return () => {
      observer.disconnect()
      window.clearTimeout(resizeTimerRef.current)
    }
  }, [virtualizer, itemCount])

  // --- Scroll event handler ---
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      if (itemCount === 0) return

      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      const isNearBottom = distanceFromBottom < bottomThreshold

      const now = performance.now()
      const isInGracePeriod = now - lastProgrammaticScrollAt.current < PROGRAMMATIC_SCROLL_GRACE_MS
      const isRecentlyLoaded = now < recentlyLoadedUntil.current

      // During grace period or recently-loaded window, only ENABLE auto-scroll
      // (when near bottom), never DISABLE it. This prevents measurement-driven
      // scroll shifts from killing auto-scroll while sizes are still settling.
      if (isInGracePeriod || isRecentlyLoaded) {
        if (isNearBottom) {
          shouldAutoScroll.current = true
        }
        // During grace periods, only disable auto-scroll if the user has scrolled
        // well beyond the bottom threshold — small measurement-driven shifts should
        // not kill auto-scroll, but deliberate scrolling should be respected.
        else if (distanceFromBottom > bottomThreshold * 3) {
          shouldAutoScroll.current = false
        }
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

      if (
        onScrollNearTop &&
        firstVisibleIndex < triggerItemCount &&
        !isFetchingOlderRef.current &&
        !olderFetchScheduled.current &&
        now > olderFetchCooldownUntil.current
      ) {
        const started = onScrollNearTop()
        if (started !== false) {
          olderFetchScheduled.current = true
        }
      }

      if (
        onScrollNearBottom &&
        !isFetchingNewerRef.current &&
        !newerFetchScheduled.current &&
        itemCount - lastVisibleIndex < triggerItemCount &&
        now > newerFetchCooldownUntil.current
      ) {
        const started = onScrollNearBottom()
        if (started !== false) {
          newerFetchScheduled.current = true
        }
      }
    }

    // When scroll momentum ends and auto-scroll is active, snap to bottom.
    // This handles measurement drift and inertia ending near-but-not-at bottom.
    const handleScrollEnd = () => {
      if (!shouldAutoScroll.current || itemCount === 0) return
      // Skip if a programmatic scroll is still settling — scrollToIndex runs a
      // multi-frame reconciliation loop and we don't need to pile on.
      if (performance.now() - lastProgrammaticScrollAt.current < PROGRAMMATIC_SCROLL_GRACE_MS) return
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      if (dist > 1) {
        lastProgrammaticScrollAt.current = performance.now()
        virtualizer.scrollToIndex(itemCount - 1, { align: "end" })
      }
    }

    el.addEventListener("scroll", handleScroll, { passive: true })
    el.addEventListener("scrollend", handleScrollEnd, { passive: true })
    return () => {
      el.removeEventListener("scroll", handleScroll)
      el.removeEventListener("scrollend", handleScrollEnd)
    }
  }, [virtualizer, onScrollNearTop, onScrollNearBottom, bottomThreshold, itemCount, triggerItemCount])

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
