import { useState, useMemo, useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import { Bell, FileText, Hash, MessageSquare, Plus, X, Archive } from "lucide-react"
import { StreamTypes } from "@threa/types"
import type { Stream, StreamType } from "@threa/types"
import { getStreamName, streamFallbackLabel } from "@/lib/streams"
import { streamsApi } from "@/api"
import { createDmDraftId } from "@/hooks/use-stream-or-draft"
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
  [StreamTypes.SYSTEM]: Bell,
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

function getStreamTypeLabel(type: StreamType): string {
  switch (type) {
    case StreamTypes.SCRATCHPAD:
      return "Scratchpad"
    case StreamTypes.CHANNEL:
      return "Channel"
    case StreamTypes.DM:
      return "Direct Message"
    case StreamTypes.SYSTEM:
      return "System"
    case StreamTypes.THREAD:
      return "Thread"
    default:
      return type
  }
}

export function useStreamItems(context: ModeContext): ModeResult {
  const {
    streams: activeStreams,
    streamMemberships,
    members,
    currentMemberId,
    dmPeers,
    query,
    onQueryChange,
    workspaceId,
    navigate,
    closeDialog,
  } = context

  const memberStreamIds = useMemo(() => {
    const ids = new Set<string>()
    for (const m of streamMemberships) ids.add(m.streamId)
    return ids
  }, [streamMemberships])

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
      (s) =>
        s.type === StreamTypes.SCRATCHPAD ||
        s.type === StreamTypes.CHANNEL ||
        s.type === StreamTypes.DM ||
        s.type === StreamTypes.SYSTEM
    )

    // Apply type filters
    if (typeFilters.length > 0) {
      filteredStreams = filteredStreams.filter((s) => typeFilters.includes(s.type))
    }

    // Score streams by match quality (lower = better)
    const scoreStream = (stream: Stream): number => {
      if (!searchText) return 0
      const name = (getStreamName(stream) ?? streamFallbackLabel(stream.type, "generic")).toLowerCase()
      if (name === lowerQuery) return 0 // Exact match
      if (name.startsWith(lowerQuery)) return 1 // Starts with
      if (name.includes(lowerQuery)) return 2 // Contains
      if (stream.id.toLowerCase().includes(lowerQuery)) return 3 // ID match
      return Infinity // No match
    }

    const streamItems = filteredStreams
      .map((stream) => ({ stream, score: scoreStream(stream) }))
      .filter(({ score }) => score !== Infinity)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score
        const aName = getStreamName(a.stream) ?? streamFallbackLabel(a.stream.type, "generic")
        const bName = getStreamName(b.stream) ?? streamFallbackLabel(b.stream.type, "generic")
        return aName.localeCompare(bName)
      })
      .map(({ stream }): QuickSwitcherItem => {
        const href = `/w/${workspaceId}/s/${stream.id}`
        const isArchived = stream.archivedAt != null
        const typeLabel = getStreamTypeLabel(stream.type)
        const notJoined = !memberStreamIds.has(stream.id) && stream.visibility === "public"
        let description = typeLabel
        if (isArchived) description = `${typeLabel} · Archived`
        else if (notJoined) description = `${typeLabel} · Not joined`
        return {
          id: stream.id,
          label: getStreamName(stream) ?? streamFallbackLabel(stream.type, "generic"),
          description,
          icon: STREAM_ICONS[stream.type],
          href,
          onSelect: () => {
            closeDialog()
            navigate(href)
          },
        }
      })

    const canShowVirtualDms =
      Boolean(currentMemberId) &&
      Boolean(members) &&
      showActive &&
      (typeFilters.length === 0 || typeFilters.includes(StreamTypes.DM))

    if (!canShowVirtualDms) {
      return streamItems
    }

    const existingDmPeerIds = new Set((dmPeers ?? []).map((peer) => peer.memberId))
    const virtualDmItems = members!
      .filter((member) => member.id !== currentMemberId)
      .filter((member) => !existingDmPeerIds.has(member.id))
      .map((member) => {
        const name = member.name
        const score = searchText ? (name.toLowerCase().includes(lowerQuery) ? 0 : Infinity) : 0
        return { member, score }
      })
      .filter(({ score }) => score !== Infinity)
      .sort((a, b) => a.member.name.localeCompare(b.member.name))
      .map(
        ({ member }): QuickSwitcherItem => ({
          id: createDmDraftId(member.id),
          label: member.name,
          description: "Direct Message · Start conversation",
          icon: STREAM_ICONS[StreamTypes.DM],
          group: "Members",
          href: `/w/${workspaceId}/s/${createDmDraftId(member.id)}`,
          onSelect: () => {
            closeDialog()
            navigate(`/w/${workspaceId}/s/${createDmDraftId(member.id)}`)
          },
        })
      )

    return [...streamItems, ...virtualDmItems]
  }, [
    activeStreams,
    archivedStreams,
    currentMemberId,
    dmPeers,
    members,
    searchText,
    showActive,
    showArchived,
    typeFilters,
    memberStreamIds,
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
