import { useState, useCallback, useEffect, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { X, Plus, User, Calendar, Hash, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useSearch, useWorkspaceBootstrap } from "@/hooks"
import type { SearchFilters } from "@/api"
import type { StreamType } from "@threa/types"
import { FilterSelect } from "./filter-select"
import type { ModeResult, QuickSwitcherItem } from "./types"
import {
  parseSearchQuery,
  removeFilterFromQuery,
  addFilterToQuery,
  getFilterLabel,
  type FilterType,
} from "./search-query-parser"

const FILTER_TYPES: { type: FilterType; label: string; icon: React.ReactNode }[] = [
  { type: "from", label: "From user", icon: <User className="h-4 w-4" /> },
  { type: "with", label: "With user", icon: <User className="h-4 w-4" /> },
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

interface UseSearchItemsParams {
  workspaceId: string
  query: string
  onQueryChange: (query: string) => void
  closeDialog: () => void
}

export function useSearchItems({ workspaceId, query, onQueryChange, closeDialog }: UseSearchItemsParams): ModeResult {
  const navigate = useNavigate()
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId)
  const { results, isLoading, search, clear } = useSearch({ workspaceId })

  const [addingFilter, setAddingFilter] = useState<FilterType | null>(null)

  const members = useMemo(() => bootstrap?.members ?? [], [bootstrap?.members])
  const users = useMemo(() => bootstrap?.users ?? [], [bootstrap?.users])
  const streams = useMemo(() => bootstrap?.streams ?? [], [bootstrap?.streams])

  // Parse filters from query string (single source of truth)
  const { filters: parsedFilters, text: searchText } = useMemo(() => parseSearchQuery(query), [query])

  // Resolve slug to user ID
  const resolveUserSlug = useCallback(
    (slug: string): string | null => {
      const user = users.find((u) => u.slug === slug)
      return user?.id ?? null
    },
    [users]
  )

  // Resolve slug to stream ID
  const resolveStreamSlug = useCallback(
    (slug: string): string | null => {
      const stream = streams.find((s) => s.slug === slug)
      return stream?.id ?? null
    },
    [streams]
  )

  // Build API filters from parsed filters, resolving slugs to IDs
  const buildFilters = useCallback((): SearchFilters => {
    const filters: SearchFilters = {}

    for (const filter of parsedFilters) {
      switch (filter.type) {
        case "from": {
          const userId = resolveUserSlug(filter.value)
          if (userId) filters.from = userId
          break
        }
        case "with": {
          const userId = resolveUserSlug(filter.value)
          if (userId) filters.with = [...(filters.with ?? []), userId]
          break
        }
        case "is":
          filters.is = [...(filters.is ?? []), filter.value as StreamType]
          break
        case "in": {
          // in: can be either a stream slug or user slug (for DMs)
          // Check if the raw value started with in:# (stream) or in:@ (user)
          const rawFilter = parsedFilters.find((f) => f === filter)
          const isStreamFilter = rawFilter?.raw.startsWith("in:#")
          if (isStreamFilter) {
            const streamId = resolveStreamSlug(filter.value)
            if (streamId) filters.in = [...(filters.in ?? []), streamId]
          } else {
            // For in:@user, we need to find the DM stream with this user
            // For now, just resolve as user ID - backend should handle DM lookup
            const userId = resolveUserSlug(filter.value)
            if (userId) filters.in = [...(filters.in ?? []), userId]
          }
          break
        }
        case "after":
          filters.after = filter.value
          break
        case "before":
          filters.before = filter.value
          break
      }
    }

    return filters
  }, [parsedFilters, resolveUserSlug, resolveStreamSlug])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchText.trim() || parsedFilters.length > 0) {
        search(searchText, buildFilters())
      } else {
        clear()
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchText, parsedFilters, search, clear, buildFilters])

  const handleAddFilter = (type: FilterType) => {
    setAddingFilter(type)
  }

  const handleFilterSelect = (value: string, _label: string) => {
    if (!addingFilter) return
    // Add filter to query string (two-way sync)
    const newQuery = addFilterToQuery(query, addingFilter, value)
    onQueryChange(newQuery)
    setAddingFilter(null)
  }

  const handleRemoveFilter = (index: number) => {
    // Remove filter from query string (two-way sync)
    const newQuery = removeFilterFromQuery(query, index)
    onQueryChange(newQuery)
  }

  const getFilterIcon = (type: FilterType) => {
    const filterType = FILTER_TYPES.find((f) => f.type === type)
    return filterType?.icon ?? null
  }

  const items = useMemo((): QuickSwitcherItem[] => {
    return results.map((result) => {
      const href = `/w/${workspaceId}/s/${result.streamId}?m=${result.id}`
      return {
        id: result.id,
        label: result.content,
        description: new Date(result.createdAt).toLocaleDateString(),
        group: "Messages",
        href,
        onSelect: () => {
          closeDialog()
          navigate(href)
        },
      }
    })
  }, [results, workspaceId, closeDialog, navigate])

  const header = (
    <>
      {(parsedFilters.length > 0 || addingFilter) && (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          {parsedFilters.map((filter, index) => (
            <Badge key={index} variant="secondary" className="gap-1 pr-1">
              {getFilterIcon(filter.type)}
              <span className="text-xs">{getFilterLabel(filter)}</span>
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
              users={users}
              streams={streams}
              streamTypes={STREAM_TYPE_OPTIONS}
              onSelect={handleFilterSelect}
              onCancel={() => setAddingFilter(null)}
            />
          )}
        </div>
      )}

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
    </>
  )

  return {
    items,
    isLoading,
    emptyMessage: query.trim() || parsedFilters.length > 0 ? "No results found." : undefined,
    header,
  }
}
