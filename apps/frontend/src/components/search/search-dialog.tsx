import { useState, useCallback, useEffect, useMemo } from "react"
import { Link } from "react-router-dom"
import { Search, X, Plus, User, Calendar, Hash, MessageSquare } from "lucide-react"
import { CommandDialog, CommandList, CommandEmpty, CommandGroup } from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useSearch, useWorkspaceBootstrap } from "@/hooks"
import type { SearchFilters } from "@/api"
import type { StreamType } from "@threa/types"
import { FilterSelect } from "./filter-select"

interface SearchDialogProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type FilterType = "from" | "is" | "in" | "after" | "before"

interface ActiveFilter {
  type: FilterType
  value: string
  label: string
}

const FILTER_TYPES: { type: FilterType; label: string; icon: React.ReactNode }[] = [
  { type: "from", label: "From user", icon: <User className="h-4 w-4" /> },
  { type: "is", label: "Stream type", icon: <Hash className="h-4 w-4" /> },
  { type: "in", label: "In stream", icon: <MessageSquare className="h-4 w-4" /> },
  { type: "after", label: "After date", icon: <Calendar className="h-4 w-4" /> },
  { type: "before", label: "Before date", icon: <Calendar className="h-4 w-4" /> },
]

const STREAM_TYPE_OPTIONS: { value: StreamType; label: string }[] = [
  { value: "scratchpad", label: "Scratchpad" },
  { value: "channel", label: "Channel" },
  { value: "dm", label: "Direct Message" },
  { value: "thread", label: "Thread" },
]

export function SearchDialog({ workspaceId, open, onOpenChange }: SearchDialogProps) {
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId)
  const { results, isLoading, search, clear } = useSearch({ workspaceId })

  const [query, setQuery] = useState("")
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([])
  const [addingFilter, setAddingFilter] = useState<FilterType | null>(null)

  // Build members and streams lists for typeahead
  const members = useMemo(() => {
    return bootstrap?.members ?? []
  }, [bootstrap?.members])

  const streams = useMemo(() => {
    return bootstrap?.streams ?? []
  }, [bootstrap?.streams])

  // Convert active filters to API format
  const buildFilters = useCallback((): SearchFilters => {
    const filters: SearchFilters = {}

    for (const filter of activeFilters) {
      switch (filter.type) {
        case "from":
          filters.from = filter.value
          break
        case "is":
          filters.is = [...(filters.is ?? []), filter.value as StreamType]
          break
        case "in":
          filters.in = [...(filters.in ?? []), filter.value]
          break
        case "after":
          filters.after = filter.value
          break
        case "before":
          filters.before = filter.value
          break
      }
    }

    return filters
  }, [activeFilters])

  // Debounced search
  useEffect(() => {
    if (!open) return

    const timer = setTimeout(() => {
      if (query.trim() || activeFilters.length > 0) {
        search(query, buildFilters())
      } else {
        clear()
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query, activeFilters, open, search, clear, buildFilters])

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("")
      setActiveFilters([])
      setAddingFilter(null)
      clear()
    }
  }, [open, clear])

  const handleAddFilter = (type: FilterType) => {
    setAddingFilter(type)
  }

  const handleFilterSelect = (value: string, label: string) => {
    if (!addingFilter) return

    setActiveFilters((prev) => [...prev, { type: addingFilter, value, label }])
    setAddingFilter(null)
  }

  const handleRemoveFilter = (index: number) => {
    setActiveFilters((prev) => prev.filter((_, i) => i !== index))
  }

  const getMessageUrl = (streamId: string, messageId: string) => {
    return `/w/${workspaceId}/s/${streamId}?m=${messageId}`
  }

  const getFilterIcon = (type: FilterType) => {
    const filterType = FILTER_TYPES.find((f) => f.type === type)
    return filterType?.icon ?? null
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-col">
        {/* Search input */}
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages..."
            className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {/* Active filters */}
        {(activeFilters.length > 0 || addingFilter) && (
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            {activeFilters.map((filter, index) => (
              <Badge key={index} variant="secondary" className="gap-1 pr-1">
                {getFilterIcon(filter.type)}
                <span className="text-xs">{filter.label}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 rounded-full hover:bg-destructive/20"
                  onClick={() => handleRemoveFilter(index)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
            {addingFilter && (
              <FilterSelect
                type={addingFilter}
                members={members}
                streams={streams}
                streamTypes={STREAM_TYPE_OPTIONS}
                onSelect={handleFilterSelect}
                onCancel={() => setAddingFilter(null)}
              />
            )}
          </div>
        )}

        {/* Add filter button */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                <Plus className="h-3 w-3" />
                Add filter
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {FILTER_TYPES.map(({ type, label, icon }) => (
                <DropdownMenuItem key={type} onClick={() => handleAddFilter(type)}>
                  {icon}
                  <span className="ml-2">{label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Results */}
        <CommandList className="max-h-[400px]">
          {isLoading && <div className="py-6 text-center text-sm text-muted-foreground">Searching...</div>}
          {!isLoading && results.length === 0 && (query.trim() || activeFilters.length > 0) && (
            <CommandEmpty>No results found.</CommandEmpty>
          )}
          {!isLoading && results.length > 0 && (
            <CommandGroup heading="Messages">
              {results.map((result) => (
                <Link
                  key={result.id}
                  to={getMessageUrl(result.streamId, result.id)}
                  onClick={() => onOpenChange(false)}
                  className="flex flex-col items-start gap-1 py-3 px-2 rounded-sm cursor-default select-none outline-none hover:bg-accent hover:text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                >
                  <div className="line-clamp-2 text-sm">{result.content}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{new Date(result.createdAt).toLocaleDateString()}</span>
                  </div>
                </Link>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </div>
    </CommandDialog>
  )
}
