import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Slash } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CommandItem } from "./types"

export interface CommandListRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

interface CommandListProps {
  items: CommandItem[]
  clientRect: (() => DOMRect | null) | null
  command: (item: CommandItem) => void
}

/**
 * Autocomplete list for /slash commands.
 * Shows available commands with descriptions and keyboard navigation.
 */
export const CommandList = forwardRef<CommandListRef, CommandListProps>(function CommandList(
  { items, clientRect, command },
  ref
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
      className="z-50 w-72 rounded-md border bg-popover text-popover-foreground shadow-md"
      role="listbox"
      aria-label="Slash command suggestions"
    >
      <ScrollArea className="max-h-64">
        <div className="p-1">
          {items.map((item, index) => (
            <button
              key={item.name}
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
              <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
                <Slash className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="flex flex-1 flex-col items-start">
                <span className="font-medium">/{item.name}</span>
                <span className="text-xs text-muted-foreground">{item.description}</span>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
})
