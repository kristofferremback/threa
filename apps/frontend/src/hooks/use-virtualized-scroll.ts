import { useRef, useState, useEffect, useLayoutEffect, useCallback, type RefObject } from "react"
import { useVirtualizer, elementScroll, type Virtualizer } from "@tanstack/react-virtual"
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
/**
 * Delay (ms) before snapping to bottom after a visible item grows while
 * auto-scrolling. Batches multiple rapid measurements (e.g. several link
 * previews loading at once) into a single snap instead of correcting each
 * one inline (which causes visible upward flicker).
 */
const BOTTOM_SNAP_DELAY_MS = 80

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
  /**
   * When true, skip the initial scroll-to-bottom on first load.
   * Used for deep-link / jump-to-message navigation where the caller
   * will position the viewport after loading completes.
   */
  skipInitialScroll?: boolean
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
  overscan = 25,
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
  skipInitialScroll = false,
}: UseVirtualizedScrollOptions): UseVirtualizedScrollReturn {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)
  const [isScrolledFarFromBottom, setIsScrolledFarFromBottom] = useState(false)

  // Prepend stability tracking
  const prevItemCountRef = useRef(0)
  const prevFirstKeyRef = useRef<string | null>(null)
  // Continuously updated distance from the bottom of the scroll container.
  // Used to restore exact viewport position after prepend — we capture before,
  // then after the DOM updates we set scrollTop = scrollHeight - clientHeight - savedDist.
  const lastDistFromBottom = useRef(0)

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

  // Track pending rAF IDs so we can cancel on stream switch
  const settleRafRef = useRef<number | undefined>(undefined)

  // Grace period after initial load
  const recentlyLoadedUntil = useRef(0)

  // Deferred snap-to-bottom timer. When a visible item grows while we're
  // pinned to bottom (e.g. link preview loads), we don't correct inline
  // (that causes flicker). Instead we let content push down naturally and
  // schedule a single snap after measurements settle.
  const bottomSnapTimer = useRef<number | undefined>(undefined)

  // Track which DOM nodes have been force-measured. WeakSet so unmounted nodes
  // are garbage-collected automatically when they leave the overscan zone.
  const measuredNodes = useRef(new WeakSet<Element>())

  // Flag set during render when a prepend is about to happen. Refs fire before
  // layout effects, so we need to tell the measureElement wrapper not to force
  // measurements that would fight with the prepend scroll restoration.
  const isPrependingRef = useRef(false)
  if (!isLoading && itemCount > 0 && prevItemCountRef.current > 0) {
    const currentFirstKey = getItemKey(0)
    isPrependingRef.current =
      itemCount > prevItemCountRef.current &&
      currentFirstKey !== prevFirstKeyRef.current &&
      prevFirstKeyRef.current !== null &&
      !shouldAutoScroll.current
  } else {
    isPrependingRef.current = false
  }

  // Custom scrollToFn marks all virtualizer-initiated scrolls (including
  // measurement corrections) as programmatic. Without this, TanStack's
  // element.scrollTo() calls for item-size corrections fire scroll events that
  // our handler misinterprets as user-initiated, which can falsely disable
  // auto-scroll or interfere with settling logic.
  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: estimateSize ?? (() => DEFAULT_ESTIMATE),
    overscan,
    getItemKey,
    scrollMargin,
    paddingStart,
    paddingEnd,
    scrollToFn: (offset, options, instance) => {
      lastProgrammaticScrollAt.current = performance.now()
      elementScroll(offset, options, instance)
    },
  })

  // TanStack skips synchronous measurement in the ref callback during user
  // scroll (isScrolling=true, scrollState=null). Items enter the DOM at their
  // estimated size, then ResizeObserver corrects a frame later — causing a
  // visible shift/jump. We wrap measureElement to force synchronous measurement
  // for newly mounted nodes. React batches the resulting resizeItem → notify →
  // setState into the current commit, so the browser only paints the final
  // correct layout. The WeakSet ensures we only force-measure each node once.
  const measureRef = useRef<typeof virtualizer.measureElement | null>(null)
  if (!measureRef.current) {
    const original = virtualizer.measureElement
    measureRef.current = (node) => {
      original(node)
      // Skip forced measurement during prepend — the layout effect handles scroll
      // restoration via distance-from-bottom, and forced resizeItem calls would
      // apply corrections that fight with that restoration.
      if (node && !measuredNodes.current.has(node) && !isPrependingRef.current) {
        measuredNodes.current.add(node)
        const index = Number(node.getAttribute("data-index"))
        if (index >= 0) {
          virtualizer.resizeItem(index, Math.round(node.getBoundingClientRect().height))
        }
      }
    }
  }
  virtualizer.measureElement = measureRef.current

  // TanStack's default correction only fires for items above the viewport
  // (item.start < scrollOffset). For items visible in the viewport, we want
  // content to push down naturally (pure DOM feel). But when pinned to bottom,
  // visible item growth (link previews, attachments) pushes us away from the
  // bottom — so we schedule a deferred snap instead of correcting inline.
  //
  // Exception: during the initial settle window (opacity=0, measurements
  // trickling in) we correct all items immediately so the invisible settle
  // phase converges quickly without deferred-snap jank.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    const scrollOffset = instance.scrollOffset ?? 0
    // Items above viewport: correct immediately (maintains viewport position)
    if (item.start < scrollOffset) return true
    // During initial settle: correct all items (invisible, fast convergence)
    if (performance.now() < recentlyLoadedUntil.current) return true
    // Items in/below viewport while pinned to bottom: let content push down
    // naturally, then snap to bottom after measurements settle.
    if (shouldAutoScroll.current) {
      window.clearTimeout(bottomSnapTimer.current)
      bottomSnapTimer.current = window.setTimeout(() => {
        if (!shouldAutoScroll.current || itemCount === 0) return
        lastProgrammaticScrollAt.current = performance.now()
        virtualizer.scrollToIndex(itemCount - 1, { align: "end" })
      }, BOTTOM_SNAP_DELAY_MS)
    }
    return false
  }

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
    setIsScrolledFarFromBottom(false)
    // Cancel any in-flight rAF settle chain or deferred snap from a previous stream
    if (settleRafRef.current !== undefined) {
      cancelAnimationFrame(settleRafRef.current)
      settleRafRef.current = undefined
    }
    window.clearTimeout(bottomSnapTimer.current)
    // Ensure opacity is restored if switching streams during settle phase
    if (scrollContainerRef.current) {
      scrollContainerRef.current.style.opacity = "1"
    }
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

        // When navigating to a specific message (deep link), skip the
        // scroll-to-bottom so jumpToEvent can position the viewport.
        if (skipInitialScroll) {
          shouldAutoScroll.current = false
          return
        }

        lastProgrammaticScrollAt.current = performance.now()
        recentlyLoadedUntil.current = performance.now() + RECENTLY_LOADED_GRACE_MS

        // Scroll to bottom, hidden until measurements stabilize. Instead of a
        // fixed 2-frame wait, loop until scrollHeight stops changing (meaning
        // all ResizeObserver measurements have applied). Cap at 500ms to avoid
        // blocking forever if something keeps changing (e.g. lazy images).
        const el = scrollContainerRef.current
        if (el) el.style.opacity = "0"
        virtualizer.scrollToIndex(itemCount - 1, { align: "end" })
        const settleStart = performance.now()
        let prevScrollHeight = el?.scrollHeight ?? 0
        const settle = () => {
          lastProgrammaticScrollAt.current = performance.now()
          virtualizer.scrollToIndex(itemCount - 1, { align: "end" })
          const currentScrollHeight = el?.scrollHeight ?? 0
          const stable = currentScrollHeight === prevScrollHeight
          prevScrollHeight = currentScrollHeight
          if (stable || performance.now() - settleStart > RECENTLY_LOADED_GRACE_MS) {
            if (el) el.style.opacity = "1"
            settleRafRef.current = undefined
          } else {
            settleRafRef.current = requestAnimationFrame(settle)
          }
        }
        settleRafRef.current = requestAnimationFrame(settle)
      }
      return
    }

    // Detect prepend: item count grew and the first key changed.
    // These conditions uniquely identify prepend — appended items don't change
    // the first key. We don't check isFetchingOlder because events arrive from
    // IDB (useLiveQuery) asynchronously, often in a different render than the
    // fetch state transition. Relying on fetch state caused the correction to
    // miss entirely, jumping the viewport by 50 messages.
    if (
      itemCount > prevCount &&
      currentFirstKey !== prevFirstKey &&
      prevFirstKey !== null &&
      !shouldAutoScroll.current
    ) {
      // Prepend: restore the same distance from the bottom that the user had
      // before new items were added. This preserves their exact viewport
      // position regardless of how many items were prepended or how accurate
      // the estimates are — no estimate-based math needed.
      // Mark as programmatic so the scroll handler doesn't interpret the
      // resulting scroll event as user-initiated (which would affect auto-scroll).
      const el = scrollContainerRef.current
      if (el) {
        lastProgrammaticScrollAt.current = performance.now()
        el.scrollTop = el.scrollHeight - el.clientHeight - lastDistFromBottom.current
      }
      isPrependingRef.current = false
    } else if (shouldAutoScroll.current && itemCount > prevCount) {
      // Append with auto-scroll: snap to bottom immediately, then re-snap
      // after one frame so ResizeObserver measurements for the new item have
      // applied. Without the re-snap, the first scrollToIndex uses the
      // *estimated* height and the measurement delta for the last item goes
      // uncorrected (TanStack's default only corrects items above viewport).
      scrollToBottomImpl()
      settleRafRef.current = requestAnimationFrame(() => {
        if (shouldAutoScroll.current) {
          lastProgrammaticScrollAt.current = performance.now()
          virtualizer.scrollToIndex(itemCount - 1, { align: "end" })
        }
        settleRafRef.current = undefined
      })
    }

    prevItemCountRef.current = itemCount
    prevFirstKeyRef.current = currentFirstKey
  }, [isLoading, itemCount, getItemKey, scrollToBottomImpl, virtualizer])

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
      lastDistFromBottom.current = distanceFromBottom
      const isNearBottom = distanceFromBottom < bottomThreshold

      const now = performance.now()
      const isProgrammatic = now - lastProgrammaticScrollAt.current < PROGRAMMATIC_SCROLL_GRACE_MS
      const isSettling = isProgrammatic || now < recentlyLoadedUntil.current

      // During settling (programmatic scroll or recent load), only disable
      // auto-scroll for clearly intentional user scrolls (3x threshold).
      // Otherwise, measurement-driven shifts would falsely kill auto-scroll.
      if (isSettling) {
        if (isNearBottom) shouldAutoScroll.current = true
        else if (distanceFromBottom > bottomThreshold * 3) shouldAutoScroll.current = false
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
