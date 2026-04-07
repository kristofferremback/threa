import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react"
import { Search, SmilePlus } from "lucide-react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import type { EmojiEntry } from "@threa/types"

const DESKTOP_COLUMNS = 8
const MOBILE_EMOJI_SIZE = 44
const MOBILE_ROW_HEIGHT = 46
const MobileVirtuosoPadding = () => <div className="h-1" />
const DesktopVirtuosoPadding = () => <div className="h-2" />
const DESKTOP_ROW_HEIGHT = 34
const CONTAINER_HEIGHT = 256
const MAX_MOBILE_COLUMNS = 8

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
  isMobile: boolean
  onClick: () => void
  onMouseEnter: () => void
}

const EmojiButton = memo(function EmojiButton({
  item,
  isSelected,
  isActive,
  isMobile,
  onClick,
  onMouseEnter,
}: EmojiButtonProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      aria-label={`:${item.shortcode}:`}
      title={`:${item.shortcode}:`}
      data-selected={isSelected ? "true" : undefined}
      className={cn(
        "flex items-center justify-center rounded cursor-pointer",
        isMobile
          ? "w-full aspect-square text-2xl active:scale-90 transition-transform duration-75"
          : "w-8 h-8 text-xl hover:bg-accent active:bg-accent",
        isSelected && !isMobile && "bg-accent ring-1 ring-ring",
        isActive && "bg-primary/10 ring-1 ring-primary/30 rounded-lg"
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
  open: boolean
  isMobile: boolean
}) {
  // Compute column count based on container width on mobile
  const [columns, setColumns] = useState(isMobile ? MAX_MOBILE_COLUMNS : DESKTOP_COLUMNS)
  const rowHeight = isMobile ? MOBILE_ROW_HEIGHT : DESKTOP_ROW_HEIGHT
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const rangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null)
  const mobileContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isMobile || !mobileContainerRef.current) return
    const el = mobileContainerRef.current
    const measure = () => {
      const width = el.clientWidth ?? 0
      if (width > 0) {
        const cols = Math.min(MAX_MOBILE_COLUMNS, Math.max(5, Math.floor(width / MOBILE_EMOJI_SIZE)))
        setColumns(cols)
      }
    }
    requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [isMobile, open])

  // Separate active emojis from the rest
  const activeEmojis = useMemo(() => {
    if (activeShortcodes.size === 0) return []
    return emojis.filter((e) => activeShortcodes.has(e.shortcode))
  }, [emojis, activeShortcodes])

  const sortedEmojis = useMemo(() => {
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

  // Reset selection when filtered items change
  useEffect(() => {
    setSelectedIndex(0)
    if (open) virtuosoRef.current?.scrollToIndex({ index: 0 })
  }, [filtered.length, open, setSelectedIndex])

  const scrollToRowIfNeeded = useCallback(
    (index: number) => {
      const row = Math.floor(index / columns)
      const range = rangeRef.current
      if (range && (row < range.startIndex || row > range.endIndex)) {
        virtuosoRef.current?.scrollToIndex({ index: row, align: row < range.startIndex ? "start" : "end" })
      }
    },
    [columns]
  )

  const scrollToRow = useCallback(
    (index: number) => {
      const row = Math.floor(index / columns)
      virtuosoRef.current?.scrollToIndex({ index: row, align: "start" })
    },
    [columns]
  )

  const visibleRowCount = Math.floor(CONTAINER_HEIGHT / rowHeight)

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

  if (isMobile) {
    return (
      <>
        {/* Search — pill-shaped with icon, full-bleed padding */}
        <div className="px-4 pt-3 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search emoji..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setSelectedIndex(0)
              }}
              className="w-full rounded-full bg-muted/60 pl-9 pr-4 py-2 text-sm outline-none placeholder:text-muted-foreground/50 focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>

        {/* Your reactions — horizontal strip */}
        {activeEmojis.length > 0 && !search && (
          <div className="px-4 pb-2">
            <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1.5">
              Your reactions
            </p>
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {activeEmojis.map((item) => (
                <EmojiButton
                  key={item.shortcode}
                  item={item}
                  isSelected={false}
                  isActive={true}
                  isMobile={true}
                  onClick={() => onSelect(item)}
                  onMouseEnter={() => {}}
                />
              ))}
            </div>
          </div>
        )}

        {/* Emoji grid — stable container keeps ResizeObserver alive across empty/non-empty transitions */}
        <div ref={mobileContainerRef} style={{ height: "min(55dvh, 360px)" }}>
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground px-4">
              No emojis found
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              totalCount={rows.length}
              fixedItemHeight={MOBILE_ROW_HEIGHT}
              increaseViewportBy={MOBILE_ROW_HEIGHT * 3}
              style={{ height: "100%" }}
              components={{ Header: MobileVirtuosoPadding, Footer: MobileVirtuosoPadding }}
              role="listbox"
              aria-label="Emoji picker"
              itemContent={(index) => {
                const rowItems = rows[index]
                return (
                  <div
                    className="px-4 pb-0.5"
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                      gap: "2px",
                    }}
                  >
                    {rowItems.map((item) => (
                      <EmojiButton
                        key={item.shortcode}
                        item={item}
                        isSelected={false}
                        isActive={activeShortcodes.has(item.shortcode)}
                        isMobile={true}
                        onClick={() => onSelect(item)}
                        onMouseEnter={() => {}}
                      />
                    ))}
                  </div>
                )
              }}
            />
          )}
        </div>
      </>
    )
  }

  // Desktop layout
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

      {/* Your reactions row */}
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
                isMobile={false}
                onClick={() => onSelect(item)}
                onMouseEnter={() => {}}
              />
            ))}
          </div>
        </div>
      )}

      {/* Emoji grid */}
      {filtered.length === 0 ? (
        <div
          className="flex items-center justify-center text-sm text-muted-foreground p-2"
          style={{ height: CONTAINER_HEIGHT }}
        >
          No emojis found
        </div>
      ) : (
        <Virtuoso
          ref={virtuosoRef}
          totalCount={rows.length}
          fixedItemHeight={DESKTOP_ROW_HEIGHT}
          increaseViewportBy={DESKTOP_ROW_HEIGHT * 3}
          rangeChanged={(range) => {
            rangeRef.current = range
          }}
          style={{ height: CONTAINER_HEIGHT }}
          components={{ Header: DesktopVirtuosoPadding, Footer: DesktopVirtuosoPadding }}
          role="listbox"
          aria-label="Emoji picker"
          itemContent={(index) => {
            const rowItems = rows[index]
            const rowStartIndex = index * columns
            return (
              <div className="flex gap-0.5 px-2 pb-0.5">
                {rowItems.map((item, colIndex) => {
                  const itemIndex = rowStartIndex + colIndex
                  return (
                    <EmojiButton
                      key={item.shortcode}
                      item={item}
                      isSelected={itemIndex === selectedIndex}
                      isActive={activeShortcodes.has(item.shortcode)}
                      isMobile={false}
                      onClick={() => onSelect(item)}
                      onMouseEnter={() => setSelectedIndex(itemIndex)}
                    />
                  )
                })}
              </div>
            )
          }}
        />
      )}

      {/* Footer — desktop only */}
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
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { emojis, emojiWeights } = useWorkspaceEmoji(workspaceId)
  const isNarrow = useIsMobile()
  const isTouchDevice = typeof window !== "undefined" && "ontouchstart" in window
  const useDrawer = isNarrow || isTouchDevice

  const handleSelect = useCallback(
    (item: EmojiEntry) => {
      onSelect(item.emoji)
      // On mobile, keep open when toggling off an active reaction
      if (useDrawer && activeShortcodes.has(item.shortcode)) {
        return
      }
      setOpen(false)
      setSearch("")
      setSelectedIndex(0)
    },
    [onSelect, useDrawer, activeShortcodes]
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
