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
const RECENTLY_LOADED_GRACE_MS = 1500

interface UseVirtualizedScrollOptions {
  /** Whether data is currently loading (delays initial scroll) */
  isLoading: boolean
  /** Total item count */
  itemCount: number
  /** Stable key for each item (event ID, session ID, etc.) */
  getItemKey: (index: number) => string
  /** Estimated item height (default: 120px) */
  estimateSize?: (index: number) => number
  /** Extra items rendered above/below viewport (default: 25) */
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
  /**
   * @deprecated No longer used — always false. Kept for API compatibility.
   */
  isSettling: boolean
}

export function useVirtualizedScroll({
  isLoading,
  itemCount,
  getItemKey,
  estimateSize,
  overscan = 25,
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

  // Grace period after initial load: prevents measurement-driven scroll
  // shifts from disabling auto-scroll while sizes are still settling.
  const recentlyLoadedUntil = useRef(0)

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
    olderFetchCooldownUntil.current = 0
    newerFetchCooldownUntil.current = 0
    isForceScrolling.current = false
    lastProgrammaticScrollAt.current = 0
    initialScrollDone.current = false
    recentlyLoadedUntil.current = 0
    setIsScrolledFarFromBottom(false)

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
        lastProgrammaticScrollAt.current = performance.now()
        recentlyLoadedUntil.current = performance.now() + RECENTLY_LOADED_GRACE_MS
        if (el) el.scrollTop = el.scrollHeight
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

  // Track fetching state transitions and start cooldown timers
  useLayoutEffect(() => {
    if (prevIsFetchingOlder.current && !isFetchingOlder) {
      olderFetchScheduled.current = false
      olderFetchCooldownUntil.current = performance.now() + FETCH_COOLDOWN_MS
    }
    if (prevIsFetchingNewer.current && !isFetchingNewer) {
      newerFetchScheduled.current = false
      newerFetchCooldownUntil.current = performance.now() + FETCH_COOLDOWN_MS
    }
    prevIsFetchingOlder.current = isFetchingOlder
    prevIsFetchingNewer.current = isFetchingNewer
    const el = scrollContainerRef.current
    if (el) {
      prevScrollHeightRef.current = el.scrollHeight
    }
  })

  // --- Auto-scroll maintenance ---
  // After every render, if auto-scroll is active and we're not at the
  // bottom, snap there. This runs in useLayoutEffect (before paint) so the
  // user never sees a frame where measurements shifted the viewport away
  // from the bottom. This single effect replaces the old settle phase,
  // post-settle correction, and rAF drift correction — the virtualizer
  // triggers re-renders when measureElement updates sizes, and we just
  // keep scrollTop pinned to the bottom on each commit.
  useLayoutEffect(() => {
    if (!shouldAutoScroll.current || itemCount === 0) return
    const el = scrollContainerRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distFromBottom > 1) {
      lastProgrammaticScrollAt.current = performance.now()
      el.scrollTop = el.scrollHeight
    }
  })

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

      const now = performance.now()
      const isInGracePeriod = now - lastProgrammaticScrollAt.current < PROGRAMMATIC_SCROLL_GRACE_MS
      const isRecentlyLoaded = now < recentlyLoadedUntil.current

      // During grace period or recently-loaded window, only ENABLE auto-scroll
      // (when near bottom), never DISABLE it. This prevents measurement-driven
      // scroll shifts from killing auto-scroll while sizes are still settling.
      if (isInGracePeriod || isRecentlyLoaded) {
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

    el.addEventListener("scroll", handleScroll, { passive: true })
    return () => el.removeEventListener("scroll", handleScroll)
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
    isSettling: false,
  }
}
