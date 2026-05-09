import { useEffect, useMemo, useState } from "react"
import { X, Filter as FilterIcon, Hash, User as UserIcon, Calendar, FileType, FileText } from "lucide-react"
import type { AttachmentCategory } from "@threa/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useWorkspaceStreams, useWorkspaceUsers } from "@/stores/workspace-store"
import { CATEGORY_OPTIONS } from "./category"
import type { ExplorerFilters } from "./use-explorer-url-state"

interface ExplorerFiltersProps {
  workspaceId: string
  filters: ExplorerFilters
  /** When the explorer was opened from a thread, surface the parent so the
   *  caller can offer a one-click "Include #parent" expansion. */
  parentStreamId: string | null
  onUpdate: (next: Partial<ExplorerFilters>) => void
}

export function ExplorerFilters({ workspaceId, filters, parentStreamId, onUpdate }: ExplorerFiltersProps) {
  const streams = useWorkspaceStreams(workspaceId)
  const users = useWorkspaceUsers(workspaceId)

  const [nameDraft, setNameDraft] = useState(filters.nameSubstring ?? "")
  useEffect(() => {
    setNameDraft(filters.nameSubstring ?? "")
  }, [filters.nameSubstring])

  const [streamSearch, setStreamSearch] = useState("")

  const streamById = useMemo(() => new Map(streams.map((s) => [s.id, s])), [streams])

  const selectedStreams = useMemo(() => {
    return filters.streamIds.map((id) => ({ id, stream: streamById.get(id) ?? null }))
  }, [filters.streamIds, streamById])

  const parentStream = useMemo(() => {
    if (!parentStreamId) return null
    return streamById.get(parentStreamId) ?? null
  }, [parentStreamId, streamById])

  const uploaderUser = useMemo(() => {
    if (!filters.uploadedBy) return null
    return users.find((u) => u.id === filters.uploadedBy) ?? null
  }, [filters.uploadedBy, users])

  // Streams the user can pick from in the picker, filtered by the search box.
  // Already-selected streams stay in the list (with a checkbox tick) so the
  // user can deselect from inside the picker without hunting for the chip.
  const pickerStreams = useMemo(() => {
    const needle = streamSearch.trim().toLowerCase()
    if (!needle) return streams
    return streams.filter((s) => {
      const slug = s.slug?.toLowerCase() ?? ""
      const name = s.displayName?.toLowerCase() ?? ""
      return slug.includes(needle) || name.includes(needle)
    })
  }, [streams, streamSearch])

  const toggleCategory = (cat: AttachmentCategory) => {
    const set = new Set(filters.categories)
    if (set.has(cat)) set.delete(cat)
    else set.add(cat)
    onUpdate({ categories: Array.from(set) })
  }

  const toggleStream = (id: string) => {
    const set = new Set(filters.streamIds)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    onUpdate({ streamIds: Array.from(set) })
  }

  const removeStream = (id: string) => {
    onUpdate({ streamIds: filters.streamIds.filter((s) => s !== id) })
  }

  const includeParent = () => {
    if (!parentStream) return
    if (filters.streamIds.includes(parentStream.id)) return
    onUpdate({ streamIds: [...filters.streamIds, parentStream.id] })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-1">
      {selectedStreams.map(({ id, stream }) => (
        <Badge key={id} variant="secondary" className="gap-1 pr-1">
          <Hash className="h-3 w-3" />
          <span className="max-w-[140px] truncate">{stream?.slug ?? stream?.displayName ?? "stream"}</span>
          <button
            type="button"
            className="rounded-full p-0.5 hover:bg-background/60"
            onClick={() => removeStream(id)}
            aria-label="Remove stream filter"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      {filters.categories.map((cat) => (
        <Badge key={cat} variant="secondary" className="gap-1 pr-1">
          <FileType className="h-3 w-3" />
          <span>{cat}</span>
          <button
            type="button"
            className="rounded-full p-0.5 hover:bg-background/60"
            onClick={() => toggleCategory(cat)}
            aria-label={`Remove ${cat} filter`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      {uploaderUser ? (
        <Badge variant="secondary" className="gap-1 pr-1">
          <UserIcon className="h-3 w-3" />
          <span className="max-w-[120px] truncate">{uploaderUser.name || uploaderUser.slug}</span>
          <button
            type="button"
            className="rounded-full p-0.5 hover:bg-background/60"
            onClick={() => onUpdate({ uploadedBy: null })}
            aria-label="Remove uploader filter"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ) : null}

      {filters.nameSubstring ? (
        <Badge variant="secondary" className="gap-1 pr-1">
          <FileText className="h-3 w-3" />
          <span className="max-w-[140px] truncate">name: {filters.nameSubstring}</span>
          <button
            type="button"
            className="rounded-full p-0.5 hover:bg-background/60"
            onClick={() => {
              setNameDraft("")
              onUpdate({ nameSubstring: null })
            }}
            aria-label="Remove name filter"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ) : null}

      {filters.before ? (
        <Badge variant="secondary" className="gap-1 pr-1">
          <Calendar className="h-3 w-3" />
          <span>before {filters.before.slice(0, 10)}</span>
          <button
            type="button"
            className="rounded-full p-0.5 hover:bg-background/60"
            onClick={() => onUpdate({ before: null })}
            aria-label="Remove before filter"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ) : null}

      {filters.after ? (
        <Badge variant="secondary" className="gap-1 pr-1">
          <Calendar className="h-3 w-3" />
          <span>after {filters.after.slice(0, 10)}</span>
          <button
            type="button"
            className="rounded-full p-0.5 hover:bg-background/60"
            onClick={() => onUpdate({ after: null })}
            aria-label="Remove after filter"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ) : null}

      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
            <Hash className="h-3 w-3" />
            Stream
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="border-b p-2">
            <Input
              autoFocus
              value={streamSearch}
              onChange={(e) => setStreamSearch(e.target.value)}
              placeholder="Find stream"
              className="h-8"
              aria-label="Find stream"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {pickerStreams.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No streams match</div>
            ) : (
              pickerStreams.map((s) => {
                const checked = filters.streamIds.includes(s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleStream(s.id)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent/50"
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                      }`}
                      aria-hidden
                    >
                      {checked ? <span className="text-[10px] leading-none">✓</span> : null}
                    </span>
                    <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate">{s.slug ?? s.displayName ?? "stream"}</span>
                  </button>
                )
              })
            )}
          </div>
          {filters.streamIds.length > 0 ? (
            <div className="flex justify-end border-t p-2">
              <Button size="sm" variant="ghost" onClick={() => onUpdate({ streamIds: [] })}>
                Clear streams
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
            <FilterIcon className="h-3 w-3" />
            Add filter
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>File type</DropdownMenuLabel>
          {CATEGORY_OPTIONS.filter((o) => o.value !== "other").map((opt) => (
            <DropdownMenuCheckboxItem
              key={opt.value}
              checked={filters.categories.includes(opt.value)}
              onCheckedChange={() => toggleCategory(opt.value)}
            >
              {opt.label}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Uploader</DropdownMenuLabel>
          {users.slice(0, 8).map((u) => (
            <DropdownMenuItem
              key={u.id}
              onSelect={() => onUpdate({ uploadedBy: u.id })}
              disabled={filters.uploadedBy === u.id}
            >
              {u.name || u.slug}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
            <FileText className="h-3 w-3" />
            Filename
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-2 p-3" align="start">
          <div className="text-xs font-medium">Match filename substring</div>
          <Input
            value={nameDraft}
            placeholder="invoice-2026"
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onUpdate({ nameSubstring: nameDraft.trim() || null })
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setNameDraft("")}>
              Clear
            </Button>
            <Button size="sm" onClick={() => onUpdate({ nameSubstring: nameDraft.trim() || null })}>
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
            <Calendar className="h-3 w-3" />
            Date
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-2 p-3" align="start">
          <label className="block text-xs">
            <span className="mb-1 block font-medium">After</span>
            <Input
              type="date"
              value={filters.after?.slice(0, 10) ?? ""}
              onChange={(e) => {
                const value = e.target.value
                onUpdate({ after: value ? new Date(value).toISOString() : null })
              }}
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium">Before</span>
            <Input
              type="date"
              value={filters.before?.slice(0, 10) ?? ""}
              onChange={(e) => {
                const value = e.target.value
                onUpdate({ before: value ? new Date(value).toISOString() : null })
              }}
            />
          </label>
        </PopoverContent>
      </Popover>

      {parentStream && !filters.streamIds.includes(parentStream.id) ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={includeParent}
          title={`Include the parent channel #${parentStream.slug ?? parentStream.displayName ?? ""}`}
        >
          + Include #{parentStream.slug ?? parentStream.displayName ?? "parent"}
        </Button>
      ) : null}
    </div>
  )
}
