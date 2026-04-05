import { useEffect, useRef, useState, type RefObject } from "react"

const HIGHLIGHT_NAME = "stream-search"
const ACTIVE_HIGHLIGHT_NAME = "stream-search-active"

/**
 * Walks text nodes in `root` and finds all case-insensitive occurrences of `query`.
 * Returns an array of Range objects, one per occurrence, in document order.
 */
function findTextRanges(root: Element, query: string): Range[] {
  if (!query) return []

  const ranges: Range[] = []
  const lowerQuery = query.toLowerCase()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)

  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent
    if (!text) continue

    const lowerText = text.toLowerCase()
    let pos = 0
    while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
      const range = document.createRange()
      range.setStart(node, pos)
      range.setEnd(node, pos + query.length)
      ranges.push(range)
      pos += query.length
    }
  }

  return ranges
}

/**
 * Maps a message-level active match (messageId + occurrence) to a global range index.
 * Finds the DOM element with data-message-id matching, then counts ranges belonging
 * to that element to find the Nth occurrence.
 */
function findActiveRangeIndex(
  root: Element,
  ranges: Range[],
  activeMessageId: string | null,
  activeOccurrence: number
): number {
  if (!activeMessageId || ranges.length === 0) return -1

  // Find the container element for the active message
  const msgEl = root.querySelector(`[data-message-id="${CSS.escape(activeMessageId)}"]`)
  if (!msgEl) return -1

  let occurrenceCount = 0
  for (let i = 0; i < ranges.length; i++) {
    if (msgEl.contains(ranges[i].startContainer)) {
      if (occurrenceCount === activeOccurrence) return i
      occurrenceCount++
    }
  }

  // Fallback: return first range in this message
  return ranges.findIndex((r) => msgEl.contains(r.startContainer))
}

/**
 * Highlights search matches in the DOM using the CSS Custom Highlight API.
 * All matches get a yellow highlight; the active match gets an orange highlight.
 * Falls back to no-op if the API is unavailable.
 */
export function useSearchHighlight(
  containerRef: RefObject<HTMLElement | null>,
  query: string,
  activeMessageId: string | null,
  activeOccurrence: number
): void {
  // Track the last active range so we can scroll it into view
  const lastActiveRef = useRef<Range | null>(null)

  // Tick bumped by a MutationObserver so highlights re-compute when virtualized
  // items enter or leave the DOM (otherwise matches outside the initial
  // rendered window never get highlighted).
  const [domTick, setDomTick] = useState(0)

  useEffect(() => {
    const root = containerRef.current
    if (!root || !query) return
    let raf = 0
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setDomTick((t) => t + 1))
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [containerRef, query])

  useEffect(() => {
    // Clean up highlights when query changes or clears
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return
    const highlights = CSS.highlights as Map<string, Highlight>

    if (!query || !containerRef.current) {
      highlights.delete(HIGHLIGHT_NAME)
      highlights.delete(ACTIVE_HIGHLIGHT_NAME)
      return
    }

    const root = containerRef.current
    const ranges = findTextRanges(root, query)

    if (ranges.length === 0) {
      highlights.delete(HIGHLIGHT_NAME)
      highlights.delete(ACTIVE_HIGHLIGHT_NAME)
      lastActiveRef.current = null
      return
    }

    // All matches (yellow)
    highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges))

    // Active match (orange)
    const activeIdx = findActiveRangeIndex(root, ranges, activeMessageId, activeOccurrence)
    if (activeIdx >= 0) {
      const activeRange = ranges[activeIdx]
      highlights.set(ACTIVE_HIGHLIGHT_NAME, new Highlight(activeRange))

      // Scroll the active match into view if it changed
      if (lastActiveRef.current !== activeRange) {
        lastActiveRef.current = activeRange
        const rect = activeRange.getBoundingClientRect()
        const container = root.closest("[data-suppress-pull-refresh]")
        if (container) {
          const containerRect = container.getBoundingClientRect()
          const isVisible = rect.top >= containerRect.top && rect.bottom <= containerRect.bottom
          if (!isVisible) {
            // Scroll the range's start node into view
            const el = activeRange.startContainer.parentElement
            el?.scrollIntoView({ block: "center", behavior: "smooth" })
          }
        }
      }
    } else {
      highlights.delete(ACTIVE_HIGHLIGHT_NAME)
      lastActiveRef.current = null
    }

    return () => {
      highlights.delete(HIGHLIGHT_NAME)
      highlights.delete(ACTIVE_HIGHLIGHT_NAME)
    }
  }, [containerRef, query, activeMessageId, activeOccurrence, domTick])
}
