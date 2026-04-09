import { startTransition, useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  BookOpen,
  Lightbulb,
  ListChecks,
  Compass,
  BookmarkIcon,
  Search,
  RefreshCw,
  Hash,
  MessageSquareQuote,
  ExternalLink,
} from "lucide-react"
import { KNOWLEDGE_TYPES, MEMO_TYPES, type KnowledgeType, type MemoType, type StreamType } from "@threa/types"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { useMemoDetail, useMemoSearch } from "@/hooks"
import { useWorkspaceStreams } from "@/stores/workspace-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { RelativeTime } from "@/components/relative-time"
import { cn } from "@/lib/utils"
import { getStreamName, streamFallbackLabel } from "@/lib/streams"
import type { MemoExplorerResult, MemoExplorerStreamRef } from "@/api"

const ALL_STREAMS = "all-streams"
const ALL_MEMO_TYPES = "all-memo-types"
const ALL_KNOWLEDGE_TYPES = "all-knowledge-types"

const KNOWLEDGE_TYPE_CONFIG: Record<
  string,
  { icon: typeof BookOpen; label: string; className: string; accent: string }
> = {
  decision: {
    icon: Compass,
    label: "Decision",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    accent: "border-l-blue-500",
  },
  learning: {
    icon: Lightbulb,
    label: "Learning",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    accent: "border-l-emerald-500",
  },
  procedure: {
    icon: ListChecks,
    label: "Procedure",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    accent: "border-l-amber-500",
  },
  context: {
    icon: BookOpen,
    label: "Context",
    className: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800",
    accent: "border-l-violet-500",
  },
  reference: {
    icon: BookmarkIcon,
    label: "Reference",
    className: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800",
    accent: "border-l-slate-500",
  },
}

function getKnowledgeConfig(type: string) {
  return KNOWLEDGE_TYPE_CONFIG[type] ?? KNOWLEDGE_TYPE_CONFIG.context
}

function updateParams(
  searchParams: URLSearchParams,
  updates: Record<string, string | null | undefined>
): URLSearchParams {
  const next = new URLSearchParams(searchParams)

  for (const [key, value] of Object.entries(updates)) {
    if (!value) {
      next.delete(key)
    } else {
      next.set(key, value)
    }
  }

  return next
}

function memoLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatStreamRef(stream: MemoExplorerStreamRef | null): string | null {
  if (!stream) return null

  if (stream.name) {
    return stream.type === "channel" && !stream.name.startsWith("#") ? `#${stream.name}` : stream.name
  }

  return streamFallbackLabel(stream.type as StreamType, "generic")
}

function buildSourceLink(workspaceId: string, streamId: string, messageId?: string): string {
  const search = messageId ? `?m=${messageId}` : ""
  return `/w/${workspaceId}/s/${streamId}${search}`
}

function KnowledgeTypeBadge({ type, size = "sm" }: { type: string; size?: "sm" | "xs" }) {
  const config = getKnowledgeConfig(type)
  const Icon = config.icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-medium",
        config.className,
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-1.5 py-px text-[10px]"
      )}
    >
      <Icon className={size === "sm" ? "h-3 w-3" : "h-2.5 w-2.5"} />
      {config.label}
    </span>
  )
}

function MemoResultItem({ result, isActive, href }: { result: MemoExplorerResult; isActive: boolean; href: string }) {
  const sourceLabel = formatStreamRef(result.sourceStream)
  const rootLabel = formatStreamRef(result.rootStream)
  const config = getKnowledgeConfig(result.memo.knowledgeType)

  return (
    <Link
      to={href}
      className={cn(
        "group block rounded-lg border-l-[3px] border border-l-transparent bg-card transition-all",
        isActive
          ? cn("border-primary/30 shadow-sm", config.accent)
          : "border-border/50 hover:border-border hover:shadow-sm"
      )}
    >
      <div className="px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[13px] font-semibold leading-snug text-foreground line-clamp-2">{result.memo.title}</h3>
          <RelativeTime
            date={result.memo.updatedAt}
            className="mt-0.5 shrink-0 text-[10px] tabular-nums text-muted-foreground/70"
          />
        </div>

        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground line-clamp-2">{result.memo.abstract}</p>

        <div className="mt-2.5 flex items-center gap-2">
          <KnowledgeTypeBadge type={result.memo.knowledgeType} size="xs" />

          {result.memo.tags.length > 0 && (
            <div className="flex items-center gap-1 overflow-hidden">
              {result.memo.tags.slice(0, 2).map((tag) => (
                <span key={tag} className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70">
                  <Hash className="h-2.5 w-2.5" />
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {(sourceLabel || rootLabel) && (
          <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground/60">
            <MessageSquareQuote className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">
              {sourceLabel}
              {sourceLabel && rootLabel && result.rootStream?.id !== result.sourceStream?.id && (
                <span className="text-muted-foreground/40"> in {rootLabel}</span>
              )}
            </span>
          </div>
        )}
      </div>
    </Link>
  )
}

function DetailSection({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">{title}</h3>
      {children}
    </section>
  )
}

export function MemoryPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const streams = useWorkspaceStreams(workspaceId ?? "")

  if (!workspaceId) {
    return null
  }

  const urlQuery = searchParams.get("q") ?? ""
  const selectedStreamId = searchParams.get("stream")
  const selectedMemoType = searchParams.get("memoType") as MemoType | null
  const selectedKnowledgeType = searchParams.get("knowledgeType") as KnowledgeType | null

  function replaceSearch(updates: Record<string, string | null | undefined>) {
    startTransition(() => {
      setSearchParams(updateParams(searchParams, updates), { replace: true })
    })
  }

  const [localQuery, setLocalQuery] = useState(urlQuery)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  // Sync URL → local when URL changes externally (e.g. "Clear" button, back/forward)
  useEffect(() => {
    setLocalQuery(urlQuery)
  }, [urlQuery])

  function handleQueryChange(value: string) {
    setLocalQuery(value)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      replaceSearch({ q: value || null, memo: null })
    }, 300)
  }

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const searchResponse = useMemoSearch(workspaceId, {
    query: urlQuery,
    limit: 50,
    filters: {
      in: selectedStreamId ? [selectedStreamId] : undefined,
      memoType: selectedMemoType ? [selectedMemoType] : undefined,
      knowledgeType: selectedKnowledgeType ? [selectedKnowledgeType] : undefined,
    },
  })

  const results = searchResponse.data?.results ?? []
  const selectedMemoId = searchParams.get("memo") ?? results[0]?.memo.id ?? null
  const selectedMemo = useMemoDetail(workspaceId, selectedMemoId)
  const isRefreshing = searchResponse.isFetching || selectedMemo.isFetching

  const streamOptions = streams
    .filter((stream) => !stream.archivedAt)
    .map((stream) => ({
      id: stream.id,
      label: getStreamName(stream) ?? streamFallbackLabel(stream.type, "generic"),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  function refresh() {
    void Promise.allSettled([searchResponse.refetch(), selectedMemoId ? selectedMemo.refetch() : Promise.resolve()])
  }

  const selectedMemoData = selectedMemo.data?.memo ?? null
  const hasActiveFilters = selectedStreamId || selectedMemoType || selectedKnowledgeType

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-card/50">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link to={`/w/${workspaceId}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>

          <div className="flex-1 min-w-0">
            <div className="relative max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                value={localQuery}
                onChange={(event) => handleQueryChange(event.target.value)}
                placeholder="Search workspace memory..."
                className="h-9 pl-9 bg-background/80 border-border/50 focus-visible:border-primary/40"
              />
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={isRefreshing}
            className="h-8 w-8 shrink-0 text-muted-foreground"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 border-t border-border/40 px-4 py-2">
          <span className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wide mr-1">Filters</span>

          <Select
            value={selectedStreamId ?? ALL_STREAMS}
            onValueChange={(value) => replaceSearch({ stream: value === ALL_STREAMS ? null : value, memo: null })}
          >
            <SelectTrigger
              className={cn(
                "h-7 w-auto gap-1.5 rounded-md border-border/50 bg-background/60 px-2.5 text-xs",
                selectedStreamId && "border-primary/40 bg-primary/5"
              )}
            >
              <SelectValue placeholder="All streams" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STREAMS}>All streams</SelectItem>
              {streamOptions.map((stream) => (
                <SelectItem key={stream.id} value={stream.id}>
                  {stream.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={selectedMemoType ?? ALL_MEMO_TYPES}
            onValueChange={(value) => replaceSearch({ memoType: value === ALL_MEMO_TYPES ? null : value, memo: null })}
          >
            <SelectTrigger
              className={cn(
                "h-7 w-auto gap-1.5 rounded-md border-border/50 bg-background/60 px-2.5 text-xs",
                selectedMemoType && "border-primary/40 bg-primary/5"
              )}
            >
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_MEMO_TYPES}>All types</SelectItem>
              {MEMO_TYPES.map((memoType) => (
                <SelectItem key={memoType} value={memoType}>
                  {memoLabel(memoType)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={selectedKnowledgeType ?? ALL_KNOWLEDGE_TYPES}
            onValueChange={(value) =>
              replaceSearch({ knowledgeType: value === ALL_KNOWLEDGE_TYPES ? null : value, memo: null })
            }
          >
            <SelectTrigger
              className={cn(
                "h-7 w-auto gap-1.5 rounded-md border-border/50 bg-background/60 px-2.5 text-xs",
                selectedKnowledgeType && "border-primary/40 bg-primary/5"
              )}
            >
              <SelectValue placeholder="All knowledge" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_KNOWLEDGE_TYPES}>All knowledge</SelectItem>
              {KNOWLEDGE_TYPES.map((knowledgeType) => (
                <SelectItem key={knowledgeType} value={knowledgeType}>
                  {memoLabel(knowledgeType)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <button
              onClick={() => replaceSearch({ stream: null, memoType: null, knowledgeType: null, memo: null })}
              className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors ml-1"
            >
              Clear
            </button>
          )}

          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground/50">
            {searchResponse.isLoading ? "\u2026" : `${results.length} memo${results.length !== 1 ? "s" : ""}`}
          </span>
        </div>
      </header>

      {/* Content */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Results list */}
        <ScrollArea className="border-b lg:w-[22rem] lg:shrink-0 lg:border-b-0 lg:border-r border-border/50">
          <div className="space-y-1.5 p-2">
            {searchResponse.isLoading && (
              <>
                <Skeleton className="h-24 rounded-lg" />
                <Skeleton className="h-24 rounded-lg" />
                <Skeleton className="h-24 rounded-lg" />
                <Skeleton className="h-24 rounded-lg" />
              </>
            )}

            {!searchResponse.isLoading && results.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="rounded-full bg-muted/50 p-3 mb-3">
                  <Search className="h-5 w-5 text-muted-foreground/40" />
                </div>
                <p className="text-sm font-medium text-muted-foreground/70">No memos found</p>
                <p className="mt-1 text-xs text-muted-foreground/50 max-w-[14rem]">
                  {localQuery
                    ? "Try adjusting your search or filters"
                    : "Memos will appear here as knowledge is extracted from conversations"}
                </p>
              </div>
            )}

            {results.map((result) => {
              const href = `/w/${workspaceId}/memory?${updateParams(searchParams, { memo: result.memo.id }).toString()}`
              return (
                <MemoResultItem
                  key={result.memo.id}
                  result={result}
                  isActive={result.memo.id === selectedMemoId}
                  href={href}
                />
              )
            })}
          </div>
        </ScrollArea>

        {/* Detail pane */}
        <ScrollArea className="flex-1">
          <main className="mx-auto max-w-3xl p-5 sm:p-8">
            {selectedMemo.isLoading && (
              <div className="space-y-6">
                <div className="space-y-3">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-8 w-3/4" />
                  <Skeleton className="h-16 w-full" />
                </div>
                <Skeleton className="h-32 w-full rounded-lg" />
              </div>
            )}

            {!selectedMemo.isLoading && !selectedMemoData && (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="rounded-full bg-muted/50 p-4 mb-4">
                  <BookOpen className="h-6 w-6 text-muted-foreground/30" />
                </div>
                <p className="text-sm text-muted-foreground/60">Select a memo to view its details and provenance</p>
              </div>
            )}

            {selectedMemoData && (
              <div className="space-y-8">
                {/* Title section */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <KnowledgeTypeBadge type={selectedMemoData.memo.knowledgeType} size="sm" />
                    <Badge variant="secondary" className="text-[10px] font-medium">
                      {memoLabel(selectedMemoData.memo.memoType)}
                    </Badge>
                    <span className="text-[11px] tabular-nums text-muted-foreground/50">
                      v{selectedMemoData.memo.version}
                    </span>
                    <span className="text-muted-foreground/30">&middot;</span>
                    <RelativeTime
                      date={selectedMemoData.memo.updatedAt}
                      className="text-[11px] text-muted-foreground/50"
                    />
                  </div>

                  <h2 className="text-xl font-semibold tracking-tight leading-tight">{selectedMemoData.memo.title}</h2>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{selectedMemoData.memo.abstract}</p>

                  {selectedMemoData.memo.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {selectedMemoData.memo.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-0.5 rounded-md bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground"
                        >
                          <Hash className="h-2.5 w-2.5" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Key points */}
                {selectedMemoData.memo.keyPoints.length > 0 && (
                  <DetailSection title="Key points">
                    <ul className="space-y-2">
                      {selectedMemoData.memo.keyPoints.map((keyPoint) => (
                        <li
                          key={keyPoint}
                          className="relative pl-4 text-sm leading-relaxed before:absolute before:left-0 before:top-[0.6em] before:h-1.5 before:w-1.5 before:rounded-full before:bg-primary/40"
                        >
                          {keyPoint}
                        </li>
                      ))}
                    </ul>
                  </DetailSection>
                )}

                {/* Provenance */}
                <DetailSection title="Provenance">
                  <div className="flex flex-wrap gap-2">
                    {selectedMemoData.sourceStream && (
                      <Link
                        to={buildSourceLink(workspaceId, selectedMemoData.sourceStream.id)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-card px-3 py-2 text-sm transition-colors hover:border-primary/30 hover:bg-primary/5"
                      >
                        <MessageSquareQuote className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">{formatStreamRef(selectedMemoData.sourceStream)}</span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground/40" />
                      </Link>
                    )}

                    {selectedMemoData.rootStream &&
                      selectedMemoData.rootStream.id !== selectedMemoData.sourceStream?.id && (
                        <Link
                          to={buildSourceLink(workspaceId, selectedMemoData.rootStream.id)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-card px-3 py-2 text-sm transition-colors hover:border-primary/30 hover:bg-primary/5"
                        >
                          <span className="text-xs text-muted-foreground/60">in</span>
                          <span className="font-medium">{formatStreamRef(selectedMemoData.rootStream)}</span>
                          <ExternalLink className="h-3 w-3 text-muted-foreground/40" />
                        </Link>
                      )}

                    {!selectedMemoData.sourceStream && !selectedMemoData.rootStream && (
                      <span className="text-sm text-muted-foreground/50">Source unavailable</span>
                    )}
                  </div>
                </DetailSection>

                {/* Source messages */}
                <DetailSection title="Source messages">
                  {selectedMemoData.sourceMessages.length === 0 ? (
                    <p className="text-sm text-muted-foreground/50">
                      No accessible source messages were retained for this memo.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {selectedMemoData.sourceMessages.map((message) => (
                        <div key={message.id} className="rounded-lg border border-border/50 bg-card">
                          <div className="flex items-center gap-2 border-b border-border/30 px-4 py-2">
                            <span className="text-xs font-semibold">{message.authorName}</span>
                            <span className="text-[10px] text-muted-foreground/40">in</span>
                            <Link
                              to={buildSourceLink(workspaceId, message.streamId, message.id)}
                              className="text-xs text-primary/80 hover:text-primary hover:underline"
                            >
                              {message.streamName}
                            </Link>
                            <span className="ml-auto">
                              <RelativeTime
                                date={message.createdAt}
                                className="text-[10px] tabular-nums text-muted-foreground/40"
                              />
                            </span>
                          </div>
                          <div className="px-4 py-3 text-sm leading-relaxed">
                            <MarkdownContent
                              content={message.content}
                              className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </DetailSection>
              </div>
            )}
          </main>
        </ScrollArea>
      </div>
    </div>
  )
}
