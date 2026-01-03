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
  const rows = []
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
  }, [items])

  // Scroll selected row into view
  useEffect(() => {
    const selectedRow = Math.floor(selectedIndex / GRID_COLUMNS)
    virtualizer.scrollToIndex(selectedRow, { align: "auto" })
  }, [selectedIndex, virtualizer])

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
            setSelectedIndex(selectedIndex - GRID_COLUMNS)
          } else {
            // Wrap to last row, same column (or last item if column doesn't exist)
            const targetIndex = (totalRows - 1) * GRID_COLUMNS + currentCol
            setSelectedIndex(Math.min(targetIndex, items.length - 1))
          }
          return true
        }
        case "ArrowDown": {
          event.preventDefault()
          const nextRowIndex = selectedIndex + GRID_COLUMNS
          if (nextRowIndex < items.length) {
            setSelectedIndex(nextRowIndex)
          } else {
            // Wrap to first row, same column
            setSelectedIndex(currentCol)
          }
          return true
        }
        case "ArrowLeft": {
          event.preventDefault()
          setSelectedIndex((prev) => (prev - 1 + items.length) % items.length)
          return true
        }
        case "ArrowRight": {
          event.preventDefault()
          setSelectedIndex((prev) => (prev + 1) % items.length)
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
    </div>
  )
}

export const EmojiGrid = forwardRef(EmojiGridInner)
