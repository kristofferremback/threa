import { forwardRef, useEffect, useImperativeHandle, useRef, useState, memo } from "react"
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
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
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const rangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null)

  // Group items into rows for virtualization
  const rows: EmojiEntry[][] = []
  for (let i = 0; i < items.length; i += GRID_COLUMNS) {
    rows.push(items.slice(i, i + GRID_COLUMNS))
  }

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0)
    virtuosoRef.current?.scrollToIndex({ index: 0 })
  }, [items])

  // Scroll to row only if it's outside the visible range
  const scrollToRowIfNeeded = (index: number) => {
    const row = Math.floor(index / GRID_COLUMNS)
    const range = rangeRef.current
    if (range && (row < range.startIndex || row > range.endIndex)) {
      virtuosoRef.current?.scrollToIndex({ index: row, align: row < range.startIndex ? "start" : "end" })
    }
  }

  // Force scroll to row (for Home/End/PageUp/PageDown)
  const scrollToRow = (index: number) => {
    const row = Math.floor(index / GRID_COLUMNS)
    virtuosoRef.current?.scrollToIndex({ index: row, align: "start" })
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
      <Virtuoso
        ref={virtuosoRef}
        totalCount={rows.length}
        fixedItemHeight={ROW_HEIGHT}
        increaseViewportBy={ROW_HEIGHT * 3}
        rangeChanged={(range) => {
          rangeRef.current = range
        }}
        style={{ height: CONTAINER_HEIGHT }}
        className="p-2"
        itemContent={(index) => {
          const rowItems = rows[index]
          const rowStartIndex = index * GRID_COLUMNS
          return (
            <div className="flex gap-0.5">
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
        }}
      />
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
