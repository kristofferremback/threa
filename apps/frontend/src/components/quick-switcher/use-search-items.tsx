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

interface UseSearchItemsParams {
  workspaceId: string
  query: string
  closeDialog: () => void
}

export function useSearchItems({ workspaceId, query, closeDialog }: UseSearchItemsParams): ModeResult {
  const navigate = useNavigate()
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId)
  const { results, isLoading, search, clear } = useSearch({ workspaceId })

  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([])
  const [addingFilter, setAddingFilter] = useState<FilterType | null>(null)

  const members = useMemo(() => bootstrap?.members ?? [], [bootstrap?.members])
  const users = useMemo(() => bootstrap?.users ?? [], [bootstrap?.users])
  const streams = useMemo(() => bootstrap?.streams ?? [], [bootstrap?.streams])

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

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim() || activeFilters.length > 0) {
        search(query, buildFilters())
      } else {
        clear()
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query, activeFilters, search, clear, buildFilters])

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
    emptyMessage: query.trim() || activeFilters.length > 0 ? "No results found." : undefined,
    header,
  }
}
