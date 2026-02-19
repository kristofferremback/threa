import { useState, useEffect, useRef, useCallback, type ReactNode, type KeyboardEvent } from "react"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"

// ============================================================================
// Types
// ============================================================================

export interface SearchableListItem {
  id: string
  label: string
  /** Secondary text shown below or beside the label */
  description?: string
}

interface SearchableListProps<T extends SearchableListItem> {
  /** Items to display (already filtered by caller) */
  items: T[]
  /** Render a single item row. Receives the item and whether it's currently highlighted. */
  renderItem: (item: T, highlighted: boolean) => ReactNode
  /** Called when an item is selected via click or Enter */
  onSelect: (item: T) => void
  /** Placeholder for the search input */
  placeholder?: string
  /** Controlled search value */
  search: string
  /** Called when search input changes */
  onSearchChange: (value: string) => void
  /** Message shown when items array is empty and search is non-empty */
  emptyMessage?: string
  /** Max height of the results list */
  maxHeight?: number
  /** Additional className for the root container */
  className?: string
  /** Icon shown in the search input (defaults to Search) */
  icon?: React.ComponentType<{ className?: string }>
}

// ============================================================================
// Component
// ============================================================================

export function SearchableList<T extends SearchableListItem>({
  items,
  renderItem,
  onSelect,
  placeholder = "Search...",
  search,
  onSearchChange,
  emptyMessage = "No results found",
  maxHeight = 192,
  className,
  icon: Icon = Search,
}: SearchableListProps<T>) {
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset highlight when items change
  useEffect(() => {
    setHighlightedIndex(items.length > 0 ? 0 : -1)
  }, [items.length, search])

  // Scroll highlighted item into view
  useEffect(() => {
    if (listRef.current && highlightedIndex >= 0) {
      const el = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`)
      el?.scrollIntoView({ block: "nearest" })
    }
  }, [highlightedIndex])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (items.length === 0) return

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setHighlightedIndex((prev) => (prev < items.length - 1 ? prev + 1 : prev))
          break
        case "ArrowUp":
          e.preventDefault()
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev))
          break
        case "Enter":
          e.preventDefault()
          if (highlightedIndex >= 0 && highlightedIndex < items.length) {
            onSelect(items[highlightedIndex])
          }
          break
      }
    },
    [items, highlightedIndex, onSelect]
  )

  return (
    <div className={cn("space-y-2", className)}>
      {/* Search input */}
      <div className="relative">
        <Icon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="h-8 pl-8 pr-3"
        />
      </div>

      {/* Results list */}
      {search.length > 0 && (
        <div
          ref={listRef}
          role="listbox"
          className="overflow-y-auto rounded-md border border-border bg-background"
          style={{ maxHeight }}
        >
          {items.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground text-center">{emptyMessage}</div>
          ) : (
            items.map((item, index) => (
              <div
                key={item.id}
                role="option"
                aria-selected={index === highlightedIndex}
                data-index={index}
                className={cn(
                  "cursor-default select-none transition-colors",
                  index === highlightedIndex ? "bg-accent" : "hover:bg-accent/50"
                )}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => onSelect(item)}
              >
                {renderItem(item, index === highlightedIndex)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
