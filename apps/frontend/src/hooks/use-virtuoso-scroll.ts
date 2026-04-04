import { useRef, useState, useLayoutEffect, useCallback } from "react"
import type { VirtuosoHandle, IndexLocationWithAlign } from "react-virtuoso"

/**
 * Arbitrary high starting index for Virtuoso's firstItemIndex.
 * When older messages are prepended, we decrement this value so
 * Virtuoso can maintain scroll position automatically.
 */
const FIRST_ITEM_INDEX = 1_000_000

/** Items from the bottom before showing "Jump to latest" */
const JUMP_TO_LATEST_ITEM_THRESHOLD = 10

interface UseVirtuosoScrollOptions {
  /** Total item count */
  itemCount: number
  /** Stable key for item at index (used for prepend detection) */
  getItemKey: (index: number) => string
  /** When this key changes, all scroll state resets (e.g. streamId) */
  resetKey?: string
  /**
   * When true, skip the initial scroll-to-bottom on first load.
   * Used for deep-link / jump-to-message navigation.
   */
  skipInitialScroll?: boolean
}

interface UseVirtuosoScrollReturn {
  /** Ref to attach to the Virtuoso component */
  virtuosoRef: React.RefObject<VirtuosoHandle | null>
  /** Virtual index of the first item (decreases as items are prepended) */
  firstItemIndex: number
  /** Initial index to scroll to on first render */
  initialTopMostItemIndex: IndexLocationWithAlign | undefined
  /** True when scrolled ~10+ items away from the bottom */
  isScrolledFarFromBottom: boolean
  /** Whether auto-scroll (followOutput) should be active */
  shouldFollowOutput: boolean
  /** Imperatively scroll to the bottom */
  scrollToBottom: (options?: { behavior?: "auto" | "smooth"; force?: boolean }) => void
  /** Disable auto-scroll (e.g. when navigating to a specific message via jump mode) */
  disableAutoScroll: () => void
  /** Called by Virtuoso's atBottomStateChange */
  handleAtBottomChange: (atBottom: boolean) => void
  /** Called by Virtuoso's rangeChanged to track distance from bottom */
  handleRangeChanged: (range: { startIndex: number; endIndex: number }) => void
}

export function useVirtuosoScroll({
  itemCount,
  getItemKey,
  resetKey,
  skipInitialScroll = false,
}: UseVirtuosoScrollOptions): UseVirtuosoScrollReturn {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [firstItemIndex, setFirstItemIndex] = useState(FIRST_ITEM_INDEX)
  const [isScrolledFarFromBottom, setIsScrolledFarFromBottom] = useState(false)

  // Auto-scroll state: when true, new messages cause scroll to bottom
  const isAtBottomRef = useRef(!skipInitialScroll)
  const [shouldFollowOutput, setShouldFollowOutput] = useState(!skipInitialScroll)

  // Prepend detection
  const prevItemCountRef = useRef(0)
  const prevFirstKeyRef = useRef<string | null>(null)

  // Reset all state when stream changes
  useLayoutEffect(() => {
    setFirstItemIndex(FIRST_ITEM_INDEX)
    setIsScrolledFarFromBottom(false)
    isAtBottomRef.current = true
    setShouldFollowOutput(true)
    prevItemCountRef.current = 0
    prevFirstKeyRef.current = null
  }, [resetKey])

  // Detect prepends and adjust firstItemIndex.
  // Virtuoso uses firstItemIndex to maintain scroll position when items are
  // added before the current viewport — decrementing it by the prepended count
  // tells Virtuoso the existing items shifted down, keeping viewport stable.
  useLayoutEffect(() => {
    if (itemCount === 0) return

    const prevCount = prevItemCountRef.current
    const prevFirstKey = prevFirstKeyRef.current
    const currentFirstKey = getItemKey(0)

    if (prevCount > 0 && itemCount > prevCount && currentFirstKey !== prevFirstKey && prevFirstKey !== null) {
      const prependedCount = itemCount - prevCount
      setFirstItemIndex((prev) => prev - prependedCount)
    }

    prevItemCountRef.current = itemCount
    prevFirstKeyRef.current = currentFirstKey
  }, [itemCount, getItemKey])

  const scrollToBottom = useCallback(
    (options?: { behavior?: "auto" | "smooth"; force?: boolean }) => {
      if (!options?.force && !isAtBottomRef.current) return
      if (itemCount === 0) return

      isAtBottomRef.current = true
      setShouldFollowOutput(true)
      setIsScrolledFarFromBottom(false)

      virtuosoRef.current?.scrollToIndex({
        index: "LAST",
        align: "end",
        behavior: options?.behavior ?? "auto",
      })
    },
    [itemCount]
  )

  const disableAutoScroll = useCallback(() => {
    isAtBottomRef.current = false
    setShouldFollowOutput(false)
  }, [])

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom
    if (atBottom) {
      setShouldFollowOutput(true)
      setIsScrolledFarFromBottom(false)
    }
  }, [])

  const handleRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }) => {
      if (itemCount === 0) return
      // endIndex is in virtual-index space; convert to distance from end
      const lastVirtualIndex = firstItemIndex + itemCount - 1
      const distFromEnd = lastVirtualIndex - range.endIndex
      setIsScrolledFarFromBottom(distFromEnd > JUMP_TO_LATEST_ITEM_THRESHOLD)
    },
    [itemCount, firstItemIndex]
  )

  const initialTopMostItemIndex =
    skipInitialScroll || itemCount === 0 ? undefined : ({ index: "LAST", align: "end" } as const)

  return {
    virtuosoRef,
    firstItemIndex,
    initialTopMostItemIndex,
    isScrolledFarFromBottom,
    shouldFollowOutput,
    scrollToBottom,
    disableAutoScroll,
    handleAtBottomChange,
    handleRangeChanged,
  }
}
