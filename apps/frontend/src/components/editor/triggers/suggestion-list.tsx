import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react"
import { useFloating, offset, flip, shift, autoUpdate, type Placement } from "@floating-ui/react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

/**
 * Common interface for suggestion list keyboard handling.
 * Each list component (MentionList, ChannelList, CommandList) implements this.
 */
export interface SuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

export interface SuggestionListProps<T> {
  items: T[]
  clientRect: (() => DOMRect | null) | null
  command: (item: T) => void
  getKey: (item: T) => string
  ariaLabel: string
  width?: string
  renderItem: (item: T) => ReactNode
  /** Preferred placement direction. Defaults to "bottom-start". Uses flip() to auto-adjust. */
  placement?: Placement
}

/**
 * Generic autocomplete suggestion list with keyboard navigation.
 * Used as the base for MentionList, ChannelList, and CommandList.
 */
function SuggestionListInner<T>(
  {
    items,
    clientRect,
    command,
    getKey,
    ariaLabel,
    width = "w-64",
    renderItem,
    placement = "bottom-start",
  }: SuggestionListProps<T>,
  ref: React.ForwardedRef<SuggestionListRef>
) {
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
    placement,
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
      style={{
        ...floatingStyles,
        // When rendered via portal to document.body, Radix Dialog sets pointer-events: none
        // on body. We need to explicitly enable pointer-events for the suggestion list.
        pointerEvents: "auto",
      }}
      className={cn("z-50 rounded-md border bg-popover text-popover-foreground shadow-md", width)}
      role="listbox"
      aria-label={ariaLabel}
    >
      <ScrollArea className="max-h-64">
        <div className="p-1">
          {items.map((item, index) => (
            <button
              key={getKey(item)}
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
              onClick={() => command(item)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              {renderItem(item)}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

// forwardRef doesn't preserve generics, so we cast it
export const SuggestionList = forwardRef(SuggestionListInner) as <T>(
  props: SuggestionListProps<T> & { ref?: React.ForwardedRef<SuggestionListRef> }
) => ReturnType<typeof SuggestionListInner>
