import { useEffect, useMemo, useRef } from "react"
import { Search, X } from "lucide-react"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useWorkspaceStreams } from "@/stores/workspace-store"
import { useExplorerUrlState } from "./use-explorer-url-state"
import { useAttachmentSearch } from "./use-attachment-search"
import { ExplorerFilters } from "./explorer-filters"
import { ExplorerList } from "./explorer-list"
import { ExplorerPreview } from "./explorer-preview"

interface AttachmentExplorerProps {
  workspaceId: string
}

/**
 * Mounted once at the workspace layout. Reads its open/closed state from URL
 * search params (INV-59) so refresh, back/forward, and shared links all
 * reproduce the exact view. There is no internal `useState` for filters.
 */
export function AttachmentExplorer({ workspaceId }: AttachmentExplorerProps) {
  const { isOpen, filters, close, update } = useExplorerUrlState()
  const streams = useWorkspaceStreams(workspaceId)

  const search = useAttachmentSearch(workspaceId, filters, { enabled: isOpen })

  const parentStreamId = useMemo(() => {
    if (filters.scope.kind !== "stream") return null
    const scopeStreamId = filters.scope.streamId
    const stream = streams.find((s) => s.id === scopeStreamId)
    if (!stream) return null
    return stream.rootStreamId ?? null
  }, [filters.scope, streams])

  const selectedItem = useMemo(() => {
    if (!filters.selectedAttachmentId) return null
    return search.items.find((item) => item.id === filters.selectedAttachmentId) ?? null
  }, [filters.selectedAttachmentId, search.items])

  // First-run selection: when results land and nothing is explicitly selected,
  // pick the top item so the preview pane is not empty.
  useEffect(() => {
    if (!isOpen) return
    if (filters.selectedAttachmentId) return
    const first = search.items[0]
    if (first) update({ selectedAttachmentId: first.id })
  }, [isOpen, filters.selectedAttachmentId, search.items, update])

  // Keyboard navigation in the list pane.
  const containerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (!search.items.length) return
      const index = search.items.findIndex((item) => item.id === filters.selectedAttachmentId)
      if (e.key === "ArrowDown") {
        e.preventDefault()
        const next = search.items[Math.min(index + 1, search.items.length - 1)]
        if (next) update({ selectedAttachmentId: next.id })
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        const prev = search.items[Math.max(index - 1, 0)]
        if (prev) update({ selectedAttachmentId: prev.id })
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [isOpen, search.items, filters.selectedAttachmentId, update])

  const hasFilters =
    filters.scope.kind === "stream" ||
    filters.categories.length > 0 ||
    Boolean(filters.uploadedBy) ||
    Boolean(filters.nameSubstring) ||
    Boolean(filters.before) ||
    Boolean(filters.after) ||
    filters.queryText.trim().length > 0

  const clearFilters = () =>
    update({
      scope: { kind: "workspace" },
      categories: [],
      uploadedBy: null,
      nameSubstring: null,
      before: null,
      after: null,
      queryText: "",
    })

  const widenScope = () => update({ scope: { kind: "workspace" } })

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={(open) => (open ? null : close())}>
      <ResponsiveDialogContent
        desktopClassName="overflow-hidden p-0 gap-0 shadow-lg sm:!fixed sm:!top-[12%] sm:!translate-y-0 sm:max-w-[920px] sm:rounded-2xl sm:!h-[76vh]"
        drawerClassName="overflow-hidden p-0"
        hideCloseButton
      >
        <ResponsiveDialogTitle className="sr-only">Files</ResponsiveDialogTitle>
        <div ref={containerRef} className="flex h-full flex-col" data-testid="attachment-explorer">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
            <Input
              autoFocus
              value={filters.queryText}
              onChange={(e) => update({ queryText: e.target.value })}
              placeholder="Search filename, content, or use “quoted phrase” for exact"
              className="h-8 border-none px-1 shadow-none focus-visible:ring-0"
              aria-label="Search attachments"
            />
            <Button size="icon" variant="ghost" onClick={close} aria-label="Close" className="h-7 w-7">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <ExplorerFilters
            workspaceId={workspaceId}
            filters={filters}
            parentStreamId={parentStreamId}
            onUpdate={update}
          />

          <div className="flex flex-1 overflow-hidden border-t">
            <div className="flex w-full flex-col overflow-y-auto sm:w-[55%] sm:border-r">
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
            <div className="hidden flex-1 sm:flex">
              <ExplorerPreview workspaceId={workspaceId} item={selectedItem} />
            </div>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
