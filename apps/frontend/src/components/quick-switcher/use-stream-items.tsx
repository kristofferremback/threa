import { useState, useMemo, useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import { FileText, Hash, MessageSquare, Plus, X, Archive } from "lucide-react"
import { StreamTypes } from "@threa/types"
import type { Stream, StreamType } from "@threa/types"
import { streamsApi } from "@/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { FilterSelect } from "./filter-select"
import {
  parseSearchQuery,
  removeFilterFromQuery,
  addFilterToQuery,
  getFilterLabel,
  type FilterType,
} from "./search-query-parser"
import type { ModeContext, ModeResult, QuickSwitcherItem } from "./types"

const STREAM_ICONS: Record<StreamType, React.ComponentType<{ className?: string }>> = {
  [StreamTypes.SCRATCHPAD]: FileText,
  [StreamTypes.CHANNEL]: Hash,
  [StreamTypes.DM]: MessageSquare,
  [StreamTypes.THREAD]: MessageSquare,
}

const FILTER_TYPES: { type: FilterType; label: string; icon: React.ReactNode }[] = [
  { type: "type", label: "Stream type", icon: <Hash className="h-4 w-4" /> },
  { type: "status", label: "Status", icon: <Archive className="h-4 w-4" /> },
]

const STREAM_TYPE_OPTIONS: { value: StreamType; label: string }[] = [
  { value: StreamTypes.SCRATCHPAD, label: "Scratchpad" },
  { value: StreamTypes.CHANNEL, label: "Channel" },
  { value: StreamTypes.DM, label: "Direct Message" },
]

const ARCHIVE_STATUS_OPTIONS: { value: "active" | "archived"; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
]

function getStreamDisplayName(stream: Stream): string {
  if (stream.type === StreamTypes.CHANNEL && stream.slug) {
    return `#${stream.slug}`
  }
  return stream.displayName || "Untitled"
}

export function useStreamItems(context: ModeContext): ModeResult {
  const { streams: activeStreams, query, onQueryChange, workspaceId, navigate, closeDialog } = context

  // Local state for the "Add filter" flow
  const [addingFilter, setAddingFilter] = useState<FilterType | null>(null)

  // Parse filters from query string (single source of truth)
  const { filters: parsedFilters, text: searchText } = useMemo(() => parseSearchQuery(query), [query])

  // Extract status and type filters
  const statusFilters = useMemo(
    () => parsedFilters.filter((f) => f.type === "status").map((f) => f.value as "active" | "archived"),
    [parsedFilters]
  )

  const typeFilters = useMemo(
    () => parsedFilters.filter((f) => f.type === "type").map((f) => f.value as StreamType),
    [parsedFilters]
  )

  // Determine what to show
  const showArchived = statusFilters.includes("archived")
  const showActive = statusFilters.length === 0 || statusFilters.includes("active")

  // Fetch archived streams when needed
  const { data: archivedStreams, isLoading: isLoadingArchived } = useQuery({
    queryKey: ["streams", workspaceId, "archived"],
    queryFn: () => streamsApi.list(workspaceId, { status: ["archived"] }),
    enabled: showArchived,
    staleTime: 30_000,
  })

  const handleAddFilter = (type: FilterType) => {
    setAddingFilter(type)
  }

  const handleFilterSelect = (value: string, _label: string) => {
    if (!addingFilter) return
    const newQuery = addFilterToQuery(query, addingFilter, value)
    // Add trailing space so cursor moves out of the filter, closing any popovers
    onQueryChange(newQuery + " ")
    setAddingFilter(null)
  }

  const handleRemoveFilter = (index: number) => {
    const newQuery = removeFilterFromQuery(query, index)
    onQueryChange(newQuery)
  }

  const closeFilterSelect = useCallback(() => {
    setAddingFilter(null)
  }, [])

  const getFilterIcon = (type: FilterType) => {
    const filterType = FILTER_TYPES.find((f) => f.type === type)
    return filterType?.icon ?? null
  }

  const items = useMemo(() => {
    const lowerQuery = searchText.toLowerCase()

    // Combine streams based on filters
    const allStreams: Stream[] = [
      ...(showActive ? activeStreams : []),
      ...(showArchived && archivedStreams ? archivedStreams : []),
    ]

    let filteredStreams = allStreams.filter(
      (s) => s.type === StreamTypes.SCRATCHPAD || s.type === StreamTypes.CHANNEL || s.type === StreamTypes.DM
    )

    // Apply type filters
    if (typeFilters.length > 0) {
      filteredStreams = filteredStreams.filter((s) => typeFilters.includes(s.type))
    }

    // Score streams by match quality (lower = better)
    const scoreStream = (stream: Stream): number => {
      if (!searchText) return 0
      const name = getStreamDisplayName(stream).toLowerCase()
      if (name === lowerQuery) return 0 // Exact match
      if (name.startsWith(lowerQuery)) return 1 // Starts with
      if (name.includes(lowerQuery)) return 2 // Contains
      if (stream.id.toLowerCase().includes(lowerQuery)) return 3 // ID match
      return Infinity // No match
    }

    return filteredStreams
      .map((stream) => ({ stream, score: scoreStream(stream) }))
      .filter(({ score }) => score !== Infinity)
      .sort((a, b) => a.score - b.score || getStreamDisplayName(a.stream).localeCompare(getStreamDisplayName(b.stream)))
      .map(({ stream }): QuickSwitcherItem => {
        const href = `/w/${workspaceId}/s/${stream.id}`
        const isArchived = stream.archivedAt != null
        return {
          id: stream.id,
          label: getStreamDisplayName(stream),
          description: isArchived ? "Archived" : undefined,
          icon: STREAM_ICONS[stream.type],
          href,
          onSelect: () => {
            closeDialog()
            navigate(href)
          },
        }
      })
  }, [
    activeStreams,
    archivedStreams,
    searchText,
    showActive,
    showArchived,
    typeFilters,
    workspaceId,
    navigate,
    closeDialog,
  ])

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
              members={[]} // Not needed for stream status/type
              users={[]} // Not needed
              streams={[]} // Not needed
              streamTypes={STREAM_TYPE_OPTIONS}
              statusOptions={ARCHIVE_STATUS_OPTIONS}
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
    isLoading: showArchived && isLoadingArchived,
    emptyMessage: "No streams found.",
    header,
    isFilterSelectActive: addingFilter !== null,
    closeFilterSelect,
  }
}
