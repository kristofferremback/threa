import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

export interface SuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

interface SuggestionListWrapperProps<T> {
  items: T[]
  query: string
  clientRect: (() => DOMRect | null) | null
  onSelect: (item: T) => void
  renderItem: (item: T, isSelected: boolean, index: number) => React.ReactNode
  getItemKey: (item: T) => string
  emptyMessage?: string
}

/**
 * A wrapper component that handles positioning and keyboard navigation
 * for suggestion lists. The actual item rendering is delegated to the caller.
 */
export const SuggestionListWrapper = forwardRef<SuggestionListRef, SuggestionListWrapperProps<unknown>>(
  function SuggestionListWrapper(props, ref) {
    const { items, clientRect, onSelect, renderItem, getItemKey, emptyMessage = "No results" } = props
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

    // Handle keyboard navigation
    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (items.length === 0) return false

        switch (event.key) {
          case "ArrowUp":
            event.preventDefault()
            setSelectedIndex((prev) => (prev - 1 + items.length) % items.length)
            return true
          case "ArrowDown":
            event.preventDefault()
            setSelectedIndex((prev) => (prev + 1) % items.length)
            return true
          case "Enter":
            event.preventDefault()
            onSelect(items[selectedIndex])
            return true
          case "Escape":
            return true
          default:
            return false
        }
      },
    }))

    if (!clientRect) return null

    return (
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="z-50 w-64 rounded-md border bg-popover text-popover-foreground shadow-md"
        role="listbox"
        aria-label="Suggestions"
      >
        <ScrollArea className="max-h-64">
          {items.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</div>
          ) : (
            <div className="p-1">
              {items.map((item, index) => (
                <button
                  key={getItemKey(item)}
                  ref={(el) => {
                    itemRefs.current[index] = el
                  }}
                  role="option"
                  aria-selected={index === selectedIndex}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                    "cursor-pointer hover:bg-accent hover:text-accent-foreground",
                    index === selectedIndex && "bg-accent text-accent-foreground"
                  )}
                  onClick={() => onSelect(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  {renderItem(item, index === selectedIndex, index)}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    )
  }
) as <T>(props: SuggestionListWrapperProps<T> & { ref?: React.Ref<SuggestionListRef> }) => React.ReactElement
