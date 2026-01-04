import { forwardRef, useEffect, useImperativeHandle, useRef, useState, memo } from "react"
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "@/lib/utils"
import type { EmojiEntry } from "@threa/types"
import type { SuggestionListRef } from "./suggestion-list"

const GRID_COLUMNS = 8
const ROW_HEIGHT = 32 // 8 (w-8) = 32px
const CONTAINER_HEIGHT = 256 // max-h-64 = 256px

export interface EmojiGridProps {
  items: EmojiEntry[]
  clientRect: (() => DOMRect | null) | null
  command: (item: EmojiEntry) => void
}

interface EmojiButtonProps {
  item: EmojiEntry
  isSelected: boolean
  onClick: () => void
  onMouseEnter: () => void
}

const EmojiButton = memo(function EmojiButton({ item, isSelected, onClick, onMouseEnter }: EmojiButtonProps) {
  return (
    <button
      role="option"
      aria-selected={isSelected}
      aria-label={`:${item.shortcode}:`}
      title={`:${item.shortcode}:`}
      data-selected={isSelected ? "true" : undefined}
      className={cn(
        "flex items-center justify-center w-8 h-8 rounded text-xl",
        "cursor-pointer hover:bg-accent",
        isSelected && "bg-accent ring-1 ring-ring"
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      {item.emoji}
    </button>
  )
})

/**
 * Virtualized grid-style emoji picker for the : trigger.
 * Shows emojis in an 8-column grid with native title tooltips.
 * Arrow keys navigate the grid (up/down by row, left/right by cell).
 */
function EmojiGridInner({ items, clientRect, command }: EmojiGridProps, ref: React.ForwardedRef<SuggestionListRef>) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Group items into rows for virtualization
  const rows: EmojiEntry[][] = []
  for (let i = 0; i < items.length; i += GRID_COLUMNS) {
    rows.push(items.slice(i, i + GRID_COLUMNS))
  }

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
  })

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0)
    virtualizer.scrollToIndex(0)
  }, [items, virtualizer])

  // Scroll to row only if it's outside the visible range
  const scrollToRowIfNeeded = (index: number) => {
    const row = Math.floor(index / GRID_COLUMNS)
    const range = virtualizer.range
    if (range && (row < range.startIndex || row > range.endIndex)) {
      virtualizer.scrollToIndex(row, { align: "auto" })
    }
  }

  // Force scroll to row (for Home/End/PageUp/PageDown)
  const scrollToRow = (index: number) => {
    const row = Math.floor(index / GRID_COLUMNS)
    virtualizer.scrollToIndex(row, { align: "start" })
  }

  // Calculate visible rows for page navigation
  const visibleRowCount = Math.floor(CONTAINER_HEIGHT / ROW_HEIGHT)

  const { refs, floatingStyles } = useFloating({
    placement: "bottom-start",
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  // Update reference element based on cursor position
  useEffect(() => {
    if (clientRect) {
      refs.setReference({
        getBoundingClientRect: () => clientRect() ?? new DOMRect(),
      })
    }
  }, [clientRect, refs])

  // Handle grid keyboard navigation
  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (items.length === 0) return false

      const totalRows = Math.ceil(items.length / GRID_COLUMNS)
      const currentRow = Math.floor(selectedIndex / GRID_COLUMNS)
      const currentCol = selectedIndex % GRID_COLUMNS

      switch (event.key) {
        case "ArrowUp": {
          event.preventDefault()
          if (currentRow > 0) {
            const newIndex = selectedIndex - GRID_COLUMNS
            setSelectedIndex(newIndex)
            scrollToRowIfNeeded(newIndex)
          }
          return true
        }
        case "ArrowDown": {
          event.preventDefault()
          const nextRowIndex = selectedIndex + GRID_COLUMNS
          if (nextRowIndex < items.length) {
            setSelectedIndex(nextRowIndex)
            scrollToRowIfNeeded(nextRowIndex)
          }
          return true
        }
        case "ArrowLeft": {
          event.preventDefault()
          if (selectedIndex > 0) {
            const newIndex = selectedIndex - 1
            setSelectedIndex(newIndex)
            scrollToRowIfNeeded(newIndex)
          }
          return true
        }
        case "ArrowRight": {
          event.preventDefault()
          if (selectedIndex < items.length - 1) {
            const newIndex = selectedIndex + 1
            setSelectedIndex(newIndex)
            scrollToRowIfNeeded(newIndex)
          }
          return true
        }
        case "Home": {
          event.preventDefault()
          setSelectedIndex(0)
          scrollToRow(0)
          return true
        }
        case "End": {
          event.preventDefault()
          const newIndex = items.length - 1
          setSelectedIndex(newIndex)
          scrollToRow(newIndex)
          return true
        }
        case "PageUp": {
          event.preventDefault()
          const jumpRows = visibleRowCount
          const newRow = Math.max(0, currentRow - jumpRows)
          const newIndex = Math.min(newRow * GRID_COLUMNS + currentCol, items.length - 1)
          setSelectedIndex(newIndex)
          scrollToRow(newIndex)
          return true
        }
        case "PageDown": {
          event.preventDefault()
          const jumpRows = visibleRowCount
          const newRow = Math.min(totalRows - 1, currentRow + jumpRows)
          const targetIndex = newRow * GRID_COLUMNS + currentCol
          const newIndex = Math.min(targetIndex, items.length - 1)
          setSelectedIndex(newIndex)
          scrollToRow(newIndex)
          return true
        }
        case "Tab":
        case "Enter":
          event.preventDefault()
          command(items[selectedIndex])
          return true
        case "Escape":
          return true
        default:
          return false
      }
    },
  }))

  if (!clientRect || items.length === 0) return null

  // Get currently selected emoji for the footer
  const selectedEmoji = items[selectedIndex]

  return (
    <div
      ref={refs.setFloating}
      style={floatingStyles}
      className="z-50 rounded-md border bg-popover text-popover-foreground shadow-md pointer-events-auto w-[280px]"
      role="listbox"
      aria-label="Emoji picker"
      data-emoji-grid
    >
      <div ref={scrollContainerRef} className="overflow-y-auto p-2" style={{ height: CONTAINER_HEIGHT }}>
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const rowItems = rows[virtualRow.index]
            const rowStartIndex = virtualRow.index * GRID_COLUMNS

            return (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: ROW_HEIGHT,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="flex gap-0.5"
              >
                {rowItems.map((item, colIndex) => {
                  const itemIndex = rowStartIndex + colIndex
                  return (
                    <EmojiButton
                      key={item.shortcode}
                      item={item}
                      isSelected={itemIndex === selectedIndex}
                      onClick={() => command(item)}
                      onMouseEnter={() => setSelectedIndex(itemIndex)}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      {/* Footer showing selected emoji shortcode */}
      {selectedEmoji && (
        <div className="border-t px-2 py-1.5 text-xs text-muted-foreground truncate">
          <span className="mr-1.5">{selectedEmoji.emoji}</span>
          <span className="font-mono">:{selectedEmoji.shortcode}:</span>
        </div>
      )}
    </div>
  )
}

export const EmojiGrid = forwardRef(EmojiGridInner)
