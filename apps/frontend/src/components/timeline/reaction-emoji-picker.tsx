import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react"
import { SmilePlus } from "lucide-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
import { cn } from "@/lib/utils"
import type { EmojiEntry } from "@threa/types"

const GRID_COLUMNS = 8
const ROW_HEIGHT = 32
const CONTAINER_HEIGHT = 256

interface ReactionEmojiPickerProps {
  workspaceId: string
  onSelect: (emoji: string) => void
  /** Custom trigger element — defaults to SmilePlus icon button */
  trigger?: React.ReactNode
  /** Additional class for the trigger wrapper */
  triggerClassName?: string
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
      type="button"
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

const GROUP_ORDER = ["smileys", "people", "animals", "food", "travel", "activities", "objects", "symbols", "flags"]

export function ReactionEmojiPicker({ workspaceId, onSelect, trigger, triggerClassName }: ReactionEmojiPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { emojis, emojiWeights } = useWorkspaceEmoji(workspaceId)

  const sortedEmojis = useMemo(() => {
    return [...emojis].sort((a, b) => {
      const weightA = emojiWeights[a.shortcode] ?? 0
      const weightB = emojiWeights[b.shortcode] ?? 0
      if (weightA > 0 && weightB === 0) return -1
      if (weightA === 0 && weightB > 0) return 1
      if (weightA !== weightB) return weightB - weightA
      const groupA = GROUP_ORDER.indexOf(a.group)
      const groupB = GROUP_ORDER.indexOf(b.group)
      const effectiveA = groupA === -1 ? GROUP_ORDER.length : groupA
      const effectiveB = groupB === -1 ? GROUP_ORDER.length : groupB
      if (effectiveA !== effectiveB) return effectiveA - effectiveB
      return a.order - b.order
    })
  }, [emojis, emojiWeights])

  const filtered = useMemo(() => {
    if (!search) return sortedEmojis
    const q = search.toLowerCase()
    return sortedEmojis.filter((e) => e.aliases.some((a) => a.includes(q)))
  }, [sortedEmojis, search])

  const rows = useMemo(() => {
    const result: EmojiEntry[][] = []
    for (let i = 0; i < filtered.length; i += GRID_COLUMNS) {
      result.push(filtered.slice(i, i + GRID_COLUMNS))
    }
    return result
  }, [filtered])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
  })

  // When the popover opens, the portal mounts the scroll container.
  // The virtualizer was initialized with null — force a re-measure.
  useEffect(() => {
    if (open) {
      // Wait one frame for the popover portal to mount and attach the ref
      requestAnimationFrame(() => {
        virtualizer.measure()
      })
    }
  }, [open, virtualizer])

  // Reset selection when filtered items change
  useEffect(() => {
    setSelectedIndex(0)
    if (open) virtualizer.scrollToIndex(0)
  }, [filtered.length, open, virtualizer])

  const handleSelect = useCallback(
    (item: EmojiEntry) => {
      onSelect(item.emoji)
      setOpen(false)
      setSearch("")
      setSelectedIndex(0)
    },
    [onSelect]
  )

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setSearch("")
      setSelectedIndex(0)
    }
  }, [])

  // Scroll to row only if it's outside the visible range
  const scrollToRowIfNeeded = useCallback(
    (index: number) => {
      const row = Math.floor(index / GRID_COLUMNS)
      const range = virtualizer.range
      if (range && (row < range.startIndex || row > range.endIndex)) {
        virtualizer.scrollToIndex(row, { align: "auto" })
      }
    },
    [virtualizer]
  )

  const scrollToRow = useCallback(
    (index: number) => {
      const row = Math.floor(index / GRID_COLUMNS)
      virtualizer.scrollToIndex(row, { align: "start" })
    },
    [virtualizer]
  )

  const visibleRowCount = Math.floor(CONTAINER_HEIGHT / ROW_HEIGHT)

  // Keyboard navigation on the search input — mirrors the editor's EmojiGrid
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (filtered.length === 0) return

      const totalRows = Math.ceil(filtered.length / GRID_COLUMNS)
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
          break
        }
        case "ArrowDown": {
          event.preventDefault()
          const nextRowIndex = selectedIndex + GRID_COLUMNS
          if (nextRowIndex < filtered.length) {
            setSelectedIndex(nextRowIndex)
            scrollToRowIfNeeded(nextRowIndex)
          }
          break
        }
        case "ArrowLeft": {
          event.preventDefault()
          if (selectedIndex > 0) {
            const newIndex = selectedIndex - 1
            setSelectedIndex(newIndex)
            scrollToRowIfNeeded(newIndex)
          }
          break
        }
        case "ArrowRight": {
          event.preventDefault()
          if (selectedIndex < filtered.length - 1) {
            const newIndex = selectedIndex + 1
            setSelectedIndex(newIndex)
            scrollToRowIfNeeded(newIndex)
          }
          break
        }
        case "Home": {
          event.preventDefault()
          setSelectedIndex(0)
          scrollToRow(0)
          break
        }
        case "End": {
          event.preventDefault()
          const newIndex = filtered.length - 1
          setSelectedIndex(newIndex)
          scrollToRow(newIndex)
          break
        }
        case "PageUp": {
          event.preventDefault()
          const upRow = Math.max(0, currentRow - visibleRowCount)
          const upIndex = Math.min(upRow * GRID_COLUMNS + currentCol, filtered.length - 1)
          setSelectedIndex(upIndex)
          scrollToRow(upIndex)
          break
        }
        case "PageDown": {
          event.preventDefault()
          const downRow = Math.min(totalRows - 1, currentRow + visibleRowCount)
          const downIndex = Math.min(downRow * GRID_COLUMNS + currentCol, filtered.length - 1)
          setSelectedIndex(downIndex)
          scrollToRow(downIndex)
          break
        }
        case "Enter":
        case "Tab": {
          event.preventDefault()
          const item = filtered[selectedIndex]
          if (item) handleSelect(item)
          break
        }
        case "Escape": {
          event.preventDefault()
          setOpen(false)
          setSearch("")
          setSelectedIndex(0)
          break
        }
        // All other keys (letters, numbers, etc.) are typed into the search input naturally
      }
    },
    [filtered, selectedIndex, handleSelect, scrollToRowIfNeeded, scrollToRow, visibleRowCount]
  )

  const selectedEmoji = filtered[selectedIndex]

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            variant="outline"
            size="icon"
            className={cn("h-6 w-6 shadow-sm hover:border-primary/30 text-muted-foreground shrink-0", triggerClassName)}
            aria-label="Add reaction"
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-[280px] p-0"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          // Focus the search input after the popover finishes animating
          requestAnimationFrame(() => {
            searchInputRef.current?.focus()
          })
        }}
      >
        {/* Search input — captures all keyboard input including arrow nav */}
        <div className="px-2 pt-2 pb-1">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search emoji..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={handleKeyDown}
            className="w-full rounded-md border bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {/* Emoji grid */}
        <div
          ref={scrollContainerRef}
          className="overflow-y-auto p-2"
          style={{ height: CONTAINER_HEIGHT }}
          role="listbox"
          aria-label="Emoji picker"
        >
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">No emojis found</div>
          ) : (
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
                          onClick={() => handleSelect(item)}
                          onMouseEnter={() => setSelectedIndex(itemIndex)}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {selectedEmoji && (
          <div className="border-t px-2 py-1.5 text-xs text-muted-foreground truncate">
            <span className="mr-1.5">{selectedEmoji.emoji}</span>
            <span className="font-mono">:{selectedEmoji.shortcode}:</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
