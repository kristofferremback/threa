import { useEffect, useMemo, useRef, useState } from "react"
import { Search, X, Loader2, Image as ImageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Toggle } from "@/components/ui/toggle"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useWorkspaceUsers, useWorkspaceStreams } from "@/stores/workspace-store"
import { getStreamName, streamFallbackLabel } from "@/lib/streams"
import { AssetItem } from "./asset-item"
import { AssetFilters } from "./asset-filters"
import { AssetGalleryHost } from "./asset-gallery-host"
import { useAssetExplorer, initialAssetFilters, type AssetExplorerFilters } from "./use-asset-explorer"
import type { AssetSearchResult, StreamType } from "@threa/types"

interface AssetExplorerPanelProps {
  workspaceId: string
  streamId: string
  open: boolean
  onClose: () => void
}

const QUERY_DEBOUNCE_MS = 250

export function AssetExplorerPanel({ workspaceId, streamId, open, onClose }: AssetExplorerPanelProps) {
  // Filter state intentionally persists across open/close within a session.
  // Reopening the panel after applying filters lands the user back where
  // they were — closing is for "out of sight" not "throw work away".
  const [filters, setFilters] = useState<AssetExplorerFilters>(initialAssetFilters)
  const [queryDraft, setQueryDraft] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // Reset draft when streamId changes — different stream = different scope,
  // so previous query no longer makes sense.
  useEffect(() => {
    setFilters(initialAssetFilters)
    setQueryDraft("")
  }, [streamId])

  // Auto-focus the search input on open; matches how `/search` opens
  // already-focused. Skipped on mobile where the soft keyboard popping is
  // disruptive when the panel is meant for browsing.
  useEffect(() => {
    if (!open) return
    // Small delay so the slide-in transition finishes before focus moves.
    const handle = setTimeout(() => {
      if (window.matchMedia("(min-width: 640px)").matches) {
        searchInputRef.current?.focus()
      }
    }, 150)
    return () => clearTimeout(handle)
  }, [open])

  // Escape closes — matches conversation panel + thread panel UX.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  // Debounce query input → committed filter so the search hook sees stable
  // updates and we don't issue a request per keystroke.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setFilters((f) => (f.query === queryDraft ? f : { ...f, query: queryDraft }))
    }, QUERY_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [queryDraft])

  const explorer = useAssetExplorer({
    workspaceId,
    scope: { type: "stream", streamId },
    filters,
    enabled: open,
  })

  const flatResults = useMemo<AssetSearchResult[]>(
    () => explorer.data?.pages.flatMap((p) => p.results) ?? [],
    [explorer.data]
  )

  const workspaceUsers = useWorkspaceUsers(workspaceId)
  const userById = useMemo(() => new Map(workspaceUsers.map((u) => [u.id, u])), [workspaceUsers])
  const streams = useWorkspaceStreams(workspaceId)
  const streamById = useMemo(() => new Map(streams.map((s) => [s.id, s])), [streams])

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry?.isIntersecting && explorer.hasNextPage && !explorer.isFetchingNextPage) {
        explorer.fetchNextPage()
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [open, explorer])

  const isInitialLoading = explorer.isPending
  const hasError = explorer.isError
  const isEmpty = !isInitialLoading && !hasError && flatResults.length === 0
  const hasActiveFilters =
    filters.query.length > 0 ||
    filters.exact ||
    filters.mimeGroups.length > 0 ||
    filters.contentTypes.length > 0 ||
    filters.before !== null ||
    filters.after !== null ||
    filters.uploadedBy !== null

  return (
    <>
      {/* Full-viewport backdrop — matches the conversation panel pattern in
          stream.tsx so panel UX stays consistent across the app. */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/60 transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label="Asset explorer"
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background shadow-lg sm:w-[28rem]",
          "transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <div className="flex min-w-0 items-center gap-2">
            <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <h2 className="truncate text-base font-semibold">Assets</h2>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Close asset explorer">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex shrink-0 flex-col gap-2 border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                value={queryDraft}
                onChange={(e) => setQueryDraft(e.target.value)}
                placeholder="Search filenames and content…"
                className="h-8 pl-7 text-sm"
                aria-label="Search assets"
              />
            </div>
            <Toggle
              size="sm"
              pressed={filters.exact}
              onPressedChange={(pressed) => setFilters((f) => ({ ...f, exact: pressed }))}
              className={cn("h-8 px-2 text-xs", filters.exact && "bg-primary/10 text-primary")}
              aria-label="Toggle exact matching"
              title="Exact (case-insensitive substring) matching"
            >
              Exact
            </Toggle>
          </div>
          <AssetFilters filters={filters} onChange={setFilters} />
        </div>

        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-0.5 p-2">
            {isInitialLoading && (
              <div className="flex h-32 items-center justify-center" role="status" aria-label="Loading assets">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {hasError && (
              <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <p>Failed to load assets.</p>
                <Button variant="outline" size="sm" onClick={() => explorer.refetch()}>
                  Try again
                </Button>
              </div>
            )}
            {isEmpty && (
              <div className="flex h-40 flex-col items-center justify-center gap-1 px-4 text-center text-sm text-muted-foreground">
                <ImageIcon className="h-6 w-6" />
                {hasActiveFilters ? (
                  <p>No assets match these filters.</p>
                ) : (
                  <>
                    <p className="font-medium text-foreground/80">No assets yet</p>
                    <p>Files shared in this stream will appear here.</p>
                  </>
                )}
              </div>
            )}
            {flatResults.map((asset) => {
              const uploader = asset.uploadedBy ? userById.get(asset.uploadedBy) : null
              const stream = asset.streamId ? streamById.get(asset.streamId) : null
              const streamName = stream
                ? (getStreamName(stream) ?? streamFallbackLabel(stream.type as StreamType, "generic"))
                : null
              return (
                <AssetItem
                  key={asset.id}
                  asset={asset}
                  workspaceId={workspaceId}
                  uploaderName={uploader?.name ?? null}
                  streamName={streamName}
                />
              )
            })}
            {explorer.hasNextPage && (
              <div ref={sentinelRef} className="flex items-center justify-center py-3">
                {explorer.isFetchingNextPage ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <span className="text-xs text-muted-foreground">Scroll for more</span>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* Gallery host claims `?media=` ownership only when one of our results
          matches, so it cohabits with `AttachmentList` instances in the
          underlying timeline without conflict. */}
      {open && <AssetGalleryHost workspaceId={workspaceId} results={flatResults} />}
    </>
  )
}
