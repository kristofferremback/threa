import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react"
import { SmilePlus } from "lucide-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import type { EmojiEntry } from "@threa/types"

const DESKTOP_COLUMNS = 8
const EMOJI_SIZE = 36 // w-8 (32px) + gap
const ROW_HEIGHT = 32
const CONTAINER_HEIGHT = 256
const MAX_MOBILE_COLUMNS = 7

interface ReactionEmojiPickerProps {
  workspaceId: string
  onSelect: (emoji: string) => void
  /** Custom trigger element — defaults to SmilePlus icon button */
  trigger?: React.ReactNode
  /** Additional class for the trigger wrapper */
  triggerClassName?: string
  /** Shortcodes the current user has already reacted with — shown first and highlighted */
  activeShortcodes?: Set<string>
  /** Controlled open state — when provided, the picker is externally controlled (no trigger rendered) */
  open?: boolean
  /** Controlled open change handler */
  onOpenChange?: (open: boolean) => void
}

interface EmojiButtonProps {
  item: EmojiEntry
  isSelected: boolean
  isActive: boolean
  onClick: () => void
  onMouseEnter: () => void
}

const EmojiButton = memo(function EmojiButton({ item, isSelected, isActive, onClick, onMouseEnter }: EmojiButtonProps) {
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
        "cursor-pointer hover:bg-accent active:bg-accent",
        isSelected && "bg-accent ring-1 ring-ring",
        isActive && !isSelected && "bg-primary/10 ring-1 ring-primary/30"
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      {item.emoji}
    </button>
  )
})

const GROUP_ORDER = ["smileys", "people", "animals", "food", "travel", "activities", "objects", "symbols", "flags"]

/** Shared emoji grid content used by both Popover (desktop) and Drawer (mobile) */
function EmojiGridContent({
  emojis,
  emojiWeights,
  activeShortcodes,
  search,
  setSearch,
  selectedIndex,
  setSelectedIndex,
  onSelect,
  onClose,
  searchInputRef,
  scrollContainerRef,
  open,
  isMobile,
}: {
  emojis: EmojiEntry[]
  emojiWeights: Record<string, number>
  activeShortcodes: Set<string>
  search: string
  setSearch: (s: string) => void
  selectedIndex: number
  setSelectedIndex: (i: number) => void
  onSelect: (item: EmojiEntry) => void
  onClose: () => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  open: boolean
  isMobile: boolean
}) {
  // Compute column count based on container width on mobile
  const [columns, setColumns] = useState(isMobile ? MAX_MOBILE_COLUMNS : DESKTOP_COLUMNS)
  useEffect(() => {
    if (!isMobile || !scrollContainerRef.current) return
    const measure = () => {
      const width = scrollContainerRef.current?.clientWidth ?? 0
      if (width > 0) {
        const cols = Math.min(MAX_MOBILE_COLUMNS, Math.max(4, Math.floor(width / EMOJI_SIZE)))
        setColumns(cols)
      }
    }
    // Measure after mount
    requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(scrollContainerRef.current)
    return () => observer.disconnect()
  }, [isMobile, open])

  // Separate active emojis from the rest
  const activeEmojis = useMemo(() => {
    if (activeShortcodes.size === 0) return []
    return emojis.filter((e) => activeShortcodes.has(e.shortcode))
  }, [emojis, activeShortcodes])

  const sortedEmojis = useMemo(() => {
    // Exclude active emojis from the main grid (they're shown in a dedicated row)
    const base = activeShortcodes.size > 0 ? emojis.filter((e) => !activeShortcodes.has(e.shortcode)) : emojis
    return [...base].sort((a, b) => {
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
  }, [emojis, emojiWeights, activeShortcodes])

  const filtered = useMemo(() => {
    if (!search) return sortedEmojis
    const q = search.toLowerCase()
    // When searching, include active emojis too (search across everything)
    const all = [...activeEmojis, ...sortedEmojis]
    return all.filter((e) => e.aliases.some((a) => a.includes(q)))
  }, [sortedEmojis, activeEmojis, search])

  const rows = useMemo(() => {
    const result: EmojiEntry[][] = []
    for (let i = 0; i < filtered.length; i += columns) {
      result.push(filtered.slice(i, i + columns))
    }
    return result
  }, [filtered, columns])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
  })

  // Force re-measure when the container mounts (portals delay ref attachment)
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        virtualizer.measure()
      })
    }
  }, [open, virtualizer])

  // Reset selection when filtered items change
  useEffect(() => {
    setSelectedIndex(0)
    if (open) virtualizer.scrollToIndex(0)
  }, [filtered.length, open, virtualizer, setSelectedIndex])

  const scrollToRowIfNeeded = useCallback(
    (index: number) => {
      const row = Math.floor(index / columns)
      const range = virtualizer.range
      if (range && (row < range.startIndex || row > range.endIndex)) {
        virtualizer.scrollToIndex(row, { align: "auto" })
      }
    },
    [virtualizer]
  )

  const scrollToRow = useCallback(
    (index: number) => {
      const row = Math.floor(index / columns)
      virtualizer.scrollToIndex(row, { align: "start" })
    },
    [virtualizer]
  )

  const visibleRowCount = Math.floor(CONTAINER_HEIGHT / ROW_HEIGHT)

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (filtered.length === 0) return

      const totalRows = Math.ceil(filtered.length / columns)
      const currentRow = Math.floor(selectedIndex / columns)
      const currentCol = selectedIndex % columns

      switch (event.key) {
        case "ArrowUp": {
          event.preventDefault()
          if (currentRow > 0) {
            const newIndex = selectedIndex - columns
            setSelectedIndex(newIndex)
            scrollToRowIfNeeded(newIndex)
          }
          break
        }
        case "ArrowDown": {
          event.preventDefault()
          const nextRowIndex = selectedIndex + columns
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
          const upIndex = Math.min(upRow * columns + currentCol, filtered.length - 1)
          setSelectedIndex(upIndex)
          scrollToRow(upIndex)
          break
        }
        case "PageDown": {
          event.preventDefault()
          const downRow = Math.min(totalRows - 1, currentRow + visibleRowCount)
          const downIndex = Math.min(downRow * columns + currentCol, filtered.length - 1)
          setSelectedIndex(downIndex)
          scrollToRow(downIndex)
          break
        }
        case "Enter":
        case "Tab": {
          event.preventDefault()
          const item = filtered[selectedIndex]
          if (item) onSelect(item)
          break
        }
        case "Escape": {
          event.preventDefault()
          onClose()
          break
        }
      }
    },
    [
      filtered,
      selectedIndex,
      setSelectedIndex,
      onSelect,
      onClose,
      scrollToRowIfNeeded,
      scrollToRow,
      visibleRowCount,
      columns,
    ]
  )

  const selectedEmoji = filtered[selectedIndex]
  const gridHeight = isMobile ? "min(50dvh, 320px)" : CONTAINER_HEIGHT

  return (
    <>
      {/* Search input */}
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

      {/* Your reactions row — only when there are active reactions and no search */}
      {activeEmojis.length > 0 && !search && (
        <div className="px-2 pb-1">
          <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider px-0.5 mb-1">
            Your reactions
          </p>
          <div className="flex gap-0.5 flex-wrap">
            {activeEmojis.map((item) => (
              <EmojiButton
                key={item.shortcode}
                item={item}
                isSelected={false}
                isActive={true}
                onClick={() => onSelect(item)}
                onMouseEnter={() => {}}
              />
            ))}
          </div>
        </div>
      )}

      {/* Emoji grid */}
      <div
        ref={scrollContainerRef}
        className="overflow-y-auto p-2"
        style={{ height: gridHeight }}
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
              const rowStartIndex = virtualRow.index * columns
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
                  className={cn("flex gap-0.5", isMobile && "justify-center")}
                >
                  {rowItems.map((item, colIndex) => {
                    const itemIndex = rowStartIndex + colIndex
                    return (
                      <EmojiButton
                        key={item.shortcode}
                        item={item}
                        isSelected={itemIndex === selectedIndex}
                        isActive={activeShortcodes.has(item.shortcode)}
                        onClick={() => onSelect(item)}
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
    </>
  )
}

const EMPTY_SET = new Set<string>()

export function ReactionEmojiPicker({
  workspaceId,
  onSelect,
  trigger,
  triggerClassName,
  activeShortcodes = EMPTY_SET,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ReactionEmojiPickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const setOpen = isControlled ? (v: boolean) => controlledOnOpenChange?.(v) : setUncontrolledOpen
  const [search, setSearch] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { emojis, emojiWeights } = useWorkspaceEmoji(workspaceId)
  const isNarrow = useIsMobile()
  // Use Drawer for touch devices (avoids keyboard pushing Popover off-screen),
  // even on tablets/phones wider than the 640px mobile breakpoint.
  const isTouchDevice = typeof window !== "undefined" && "ontouchstart" in window
  const useDrawer = isNarrow || isTouchDevice

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

  const handleClose = useCallback(() => {
    setOpen(false)
    setSearch("")
    setSelectedIndex(0)
  }, [])

  const focusSearch = useCallback(() => {
    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })
  }, [])

  const triggerElement = trigger ?? (
    <Button
      variant="outline"
      size="icon"
      className={cn("h-6 w-6 shadow-sm hover:border-primary/30 text-muted-foreground shrink-0", triggerClassName)}
      aria-label="Add reaction"
    >
      <SmilePlus className="h-3.5 w-3.5" />
    </Button>
  )

  const gridContent = (
    <EmojiGridContent
      emojis={emojis}
      emojiWeights={emojiWeights}
      activeShortcodes={activeShortcodes}
      search={search}
      setSearch={setSearch}
      selectedIndex={selectedIndex}
      setSelectedIndex={setSelectedIndex}
      onSelect={handleSelect}
      onClose={handleClose}
      searchInputRef={searchInputRef}
      scrollContainerRef={scrollContainerRef}
      open={open}
      isMobile={useDrawer}
    />
  )

  if (useDrawer) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        {!isControlled && <DrawerTrigger asChild>{triggerElement}</DrawerTrigger>}
        <DrawerContent className="max-h-[85dvh]">
          <DrawerTitle className="sr-only">Pick an emoji</DrawerTitle>
          {gridContent}
          <div className="pb-[max(8px,env(safe-area-inset-bottom))]" />
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{triggerElement}</PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-[280px] p-0"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          focusSearch()
        }}
      >
        {gridContent}
      </PopoverContent>
    </Popover>
  )
}
