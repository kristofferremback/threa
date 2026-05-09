import { useEffect, useMemo, useRef } from "react"
import { ArrowLeft, Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useIsMobile } from "@/hooks/use-mobile"
import { useWorkspaceStreams } from "@/stores/workspace-store"
import { useExplorerUrlState } from "./use-explorer-url-state"
import { useAttachmentSearch } from "./use-attachment-search"
import { ExplorerFilters } from "./explorer-filters"
import { ExplorerList } from "./explorer-list"
import { ExplorerPreview } from "./explorer-preview"

interface ExplorerShellProps {
  workspaceId: string
  /**
   * "modal" hides the page chrome and shows a close button that strips the
   * URL marker. "page" omits the close button — the surface owns its own
   * navigation chrome (back button, sidebar, etc.) and never closes.
   */
  mode: "modal" | "page"
  enabled: boolean
}

export function ExplorerShell({ workspaceId, mode, enabled }: ExplorerShellProps) {
  const { filters, close, update } = useExplorerUrlState()
  const streams = useWorkspaceStreams(workspaceId)
  const isMobile = useIsMobile()

  const search = useAttachmentSearch(workspaceId, filters, { enabled })

  const parentStreamId = useMemo(() => {
    // Surface a single parent only when exactly one stream is filtered to —
    // otherwise the "include parent" prompt would be ambiguous.
    if (filters.streamIds.length !== 1) return null
    const stream = streams.find((s) => s.id === filters.streamIds[0])
    if (!stream) return null
    return stream.rootStreamId ?? null
  }, [filters.streamIds, streams])

  const selectedItem = useMemo(() => {
    if (!filters.selectedAttachmentId) return null
    return search.items.find((item) => item.id === filters.selectedAttachmentId) ?? null
  }, [filters.selectedAttachmentId, search.items])

  // Auto-select the first item on desktop so the preview pane has content.
  // On mobile selecting auto would hide the list immediately, so we wait for
  // an explicit tap.
  useEffect(() => {
    if (!enabled || isMobile) return
    if (filters.selectedAttachmentId) return
    const first = search.items[0]
    if (first) update({ selectedAttachmentId: first.id })
  }, [enabled, isMobile, filters.selectedAttachmentId, search.items, update])

  const containerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return
      }
      if (!search.items.length) return
      const index = search.items.findIndex((item) => item.id === filters.selectedAttachmentId)
      if (e.key === "ArrowDown") {
        e.preventDefault()
        const next = search.items[Math.min(index + 1, search.items.length - 1)]
        if (next) update({ selectedAttachmentId: next.id })
      } else {
        e.preventDefault()
        const prev = search.items[Math.max(index - 1, 0)]
        if (prev) update({ selectedAttachmentId: prev.id })
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [enabled, search.items, filters.selectedAttachmentId, update])

  const hasFilters =
    filters.streamIds.length > 0 ||
    filters.categories.length > 0 ||
    Boolean(filters.uploadedBy) ||
    Boolean(filters.nameSubstring) ||
    Boolean(filters.before) ||
    Boolean(filters.after) ||
    filters.queryText.trim().length > 0

  const clearFilters = () =>
    update({
      streamIds: [],
      categories: [],
      uploadedBy: null,
      nameSubstring: null,
      before: null,
      after: null,
      queryText: "",
    })

  const widenScope = () => update({ streamIds: [] })

  const showPreviewOnly = isMobile && Boolean(selectedItem)

  return (
    <div ref={containerRef} className="flex h-full flex-col" data-testid="attachment-explorer">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {showPreviewOnly ? (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => update({ selectedAttachmentId: null })}
            aria-label="Back to file list"
            className="h-7 w-7"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        ) : (
          <Search className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
        )}
        <Input
          autoFocus={mode === "modal"}
          value={filters.queryText}
          onChange={(e) => update({ queryText: e.target.value })}
          placeholder="Search filename, content, or use “quoted phrase” for exact"
          className="h-8 border-none px-1 shadow-none focus-visible:ring-0"
          aria-label="Search attachments"
        />
        {mode === "modal" ? (
          <Button size="icon" variant="ghost" onClick={close} aria-label="Close" className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {showPreviewOnly ? null : (
        <ExplorerFilters
          workspaceId={workspaceId}
          filters={filters}
          parentStreamId={parentStreamId}
          onUpdate={update}
        />
      )}

      <div className="flex flex-1 overflow-hidden border-t">
        <div className={showPreviewOnly ? "hidden" : "flex w-full flex-col overflow-y-auto sm:w-[55%] sm:border-r"}>
          <ExplorerList
            workspaceId={workspaceId}
            items={search.items}
            isLoading={search.isLoading}
            isError={search.isError}
            hasNextPage={search.hasNextPage}
            isFetchingNextPage={search.isFetchingNextPage}
            fetchNextPage={search.fetchNextPage}
            selectedId={filters.selectedAttachmentId}
            onSelect={(id) => update({ selectedAttachmentId: id })}
            hasFilters={hasFilters}
            onClearFilters={clearFilters}
            onWidenScope={widenScope}
          />
        </div>
        <div className={showPreviewOnly ? "flex w-full flex-1" : "hidden flex-1 sm:flex"}>
          <ExplorerPreview workspaceId={workspaceId} item={selectedItem} />
        </div>
      </div>
    </div>
  )
}
