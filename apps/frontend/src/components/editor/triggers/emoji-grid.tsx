import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { EmojiEntry } from "@threa/types"
import type { SuggestionListRef } from "./suggestion-list"

const GRID_COLUMNS = 8

export interface EmojiGridProps {
  items: EmojiEntry[]
  clientRect: (() => DOMRect | null) | null
  command: (item: EmojiEntry) => void
}

/**
 * Grid-style emoji picker for the : trigger.
 * Shows emojis in an 8-column grid with tooltips for shortcodes.
 * Arrow keys navigate the grid (up/down by row, left/right by cell).
 */
function EmojiGridInner({ items, clientRect, command }: EmojiGridProps, ref: React.ForwardedRef<SuggestionListRef>) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [items])

  // Scroll selected item into view
  useEffect(() => {
    const selectedRef = itemRefs.current[selectedIndex]
    selectedRef?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

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

      const rows = Math.ceil(items.length / GRID_COLUMNS)
      const currentRow = Math.floor(selectedIndex / GRID_COLUMNS)
      const currentCol = selectedIndex % GRID_COLUMNS

      switch (event.key) {
        case "ArrowUp": {
          event.preventDefault()
          if (currentRow > 0) {
            setSelectedIndex(selectedIndex - GRID_COLUMNS)
          } else {
            // Wrap to last row, same column (or last item if column doesn't exist)
            const targetIndex = (rows - 1) * GRID_COLUMNS + currentCol
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
    >
      <ScrollArea className="max-h-64">
        <div className="grid grid-cols-8 gap-0.5 p-2">
          {items.map((item, index) => (
            <Tooltip key={item.shortcode} delayDuration={300}>
              <TooltipTrigger asChild>
                <button
                  ref={(el) => {
                    itemRefs.current[index] = el
                  }}
                  role="option"
                  aria-selected={index === selectedIndex}
                  aria-label={`:${item.shortcode}:`}
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded text-xl",
                    "cursor-pointer hover:bg-accent",
                    index === selectedIndex && "bg-accent ring-1 ring-ring"
                  )}
                  onClick={() => command(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  {item.emoji}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                :{item.shortcode}:
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

export const EmojiGrid = forwardRef(EmojiGridInner)
