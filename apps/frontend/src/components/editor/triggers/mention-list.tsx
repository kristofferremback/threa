import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { Mentionable } from "./types"

export interface MentionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

interface MentionListProps {
  items: Mentionable[]
  clientRect: (() => DOMRect | null) | null
  command: (item: Mentionable) => void
}

/**
 * Autocomplete list for @mentions.
 * Shows users, personas, and broadcast options with keyboard navigation.
 */
export const MentionList = forwardRef<MentionListRef, MentionListProps>(function MentionList(
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

  const typeLabels: Record<Mentionable["type"], string> = {
    user: "User",
    persona: "Persona",
    broadcast: "Notify",
  }

  const typeColors: Record<Mentionable["type"], string> = {
    user: "text-blue-600 dark:text-blue-400",
    persona: "text-primary",
    broadcast: "text-orange-600 dark:text-orange-400",
  }

  return (
    <div
      ref={refs.setFloating}
      style={floatingStyles}
      className="z-50 w-64 rounded-md border bg-popover text-popover-foreground shadow-md"
      role="listbox"
      aria-label="Mention suggestions"
    >
      <ScrollArea className="max-h-64">
        <div className="p-1">
          {items.map((item, index) => (
            <button
              key={item.id}
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
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-xs">
                  {item.avatarEmoji ?? item.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-1 flex-col items-start">
                <span className="font-medium">{item.name}</span>
                <span className={cn("text-xs", typeColors[item.type])}>
                  @{item.slug} · {typeLabels[item.type]}
                </span>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
})
