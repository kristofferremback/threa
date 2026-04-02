import { useEffect, useRef, useCallback, type KeyboardEvent } from "react"
import { Search, X, ChevronUp, ChevronDown, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { useStreamSearch } from "@/hooks/use-stream-search"

interface StreamSearchBarProps {
  search: ReturnType<typeof useStreamSearch>
  onClose: () => void
  /** Called when the active result changes (navigate to that message) */
  onNavigate: (messageId: string) => void
}

/** Debounce delay in milliseconds for auto-search on typing */
const DEBOUNCE_MS = 300

export function StreamSearchBar({ search, onClose, onNavigate }: StreamSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevActiveResultIdRef = useRef<string | null>(null)

  // Auto-focus the input when the bar mounts
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Navigate when active result changes
  useEffect(() => {
    const resultId = search.activeResult?.id ?? null
    if (resultId && resultId !== prevActiveResultIdRef.current) {
      onNavigate(resultId)
    }
    prevActiveResultIdRef.current = resultId
  }, [search.activeResult, onNavigate])

  // Debounced search on query change
  const handleQueryChange = useCallback(
    (value: string) => {
      search.setQuery(value)

      if (debounceRef.current) clearTimeout(debounceRef.current)

      if (value.trim()) {
        debounceRef.current = setTimeout(() => {
          search.search()
        }, DEBOUNCE_MS)
      } else {
        search.clear()
      }
    },
    [search]
  )

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }

      if (e.key === "Enter") {
        e.preventDefault()
        if (e.shiftKey) {
          search.prevResult()
        } else {
          // If no results yet, trigger search; otherwise go to next
          if (search.resultCount === 0 && search.query.trim()) {
            search.search()
          } else {
            search.nextResult()
          }
        }
        return
      }
    },
    [onClose, search]
  )

  const hasQuery = search.query.trim().length > 0
  const showCount = hasQuery && !search.isSearching && search.hasSearched

  return (
    <div
      className={cn(
        "absolute top-0 left-0 right-0 z-20",
        "flex items-center gap-1.5 px-2 py-1.5 sm:px-4 sm:py-2",
        "bg-background/95 backdrop-blur-sm border-b shadow-sm"
      )}
    >
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          type="text"
          placeholder="Search in conversation..."
          value={search.query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-8 pl-8 pr-2 text-sm border-0 bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {/* Result count / loading indicator */}
      <div className="flex items-center gap-0.5 text-xs text-muted-foreground shrink-0 min-w-[60px] justify-center">
        {search.isSearching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {showCount && search.resultCount > 0 && (
          <span>
            {search.activeIndex + 1}/{search.resultCount}
          </span>
        )}
        {showCount && search.resultCount === 0 && <span>No results</span>}
      </div>

      {/* Navigation arrows */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={search.prevResult}
          disabled={search.resultCount === 0}
          aria-label="Previous result"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={search.nextResult}
          disabled={search.resultCount === 0}
          aria-label="Next result"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Close button */}
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose} aria-label="Close search">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
