import { useState, useMemo, useCallback, useEffect } from "react"
import { useNavigate, useParams, useLocation } from "react-router-dom"
import { FileText, Hash, MessageSquare, Bell, Search, Plus, Link as LinkIcon, Image, Paperclip } from "lucide-react"
import { StreamTypes, getAvatarUrl } from "@threa/types"
import type { Stream, StreamType } from "@threa/types"
import { useWorkspaceBootstrap } from "@/hooks"
import {
  useShareTarget,
  clearShareTargetCache,
  readShareTargetFiles,
  type ShareData,
  type ShareMeta,
} from "@/hooks/use-share-target"
import { getStreamName, streamFallbackLabel } from "@/lib/streams"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ItemList } from "@/components/quick-switcher/item-list"
import type { QuickSwitcherItem } from "@/components/quick-switcher/types"

const STREAM_ICONS: Record<StreamType, React.ComponentType<{ className?: string }>> = {
  [StreamTypes.SCRATCHPAD]: FileText,
  [StreamTypes.CHANNEL]: Hash,
  [StreamTypes.DM]: MessageSquare,
  [StreamTypes.THREAD]: MessageSquare,
  [StreamTypes.SYSTEM]: Bell,
}

const TYPE_LABELS: Partial<Record<StreamType, string>> = {
  [StreamTypes.SCRATCHPAD]: "Scratchpad",
  [StreamTypes.CHANNEL]: "Channel",
  [StreamTypes.DM]: "Direct Message",
}

/**
 * Share destination picker — workspace-scoped page shown when content is shared to Threa.
 *
 * Displays a searchable stream list so the user can choose where to place the shared content.
 * A "New scratchpad" option is always available at the top.
 */
export function SharePickerPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { data: bootstrap, error: bootstrapError } = useWorkspaceBootstrap(workspaceId!)
  const { createShareDraft, saveShareContent } = useShareTarget()

  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [files, setFiles] = useState<File[]>([])

  // Only lightweight text metadata comes from navigation state — files stay in Cache API
  // to avoid hitting browser history.state serialization limits (~640 KB in Firefox).
  const shareMeta: ShareMeta = useMemo(() => {
    const state = location.state as { shareMeta?: ShareMeta | null } | null
    return state?.shareMeta ?? { title: null, text: null, url: null, hasFiles: false }
  }, [location.state])

  const { title, text, url, hasFiles } = shareMeta

  // Read file blobs from the Cache API on mount (not from navigation state)
  useEffect(() => {
    if (!hasFiles) return
    let cancelled = false
    readShareTargetFiles().then((f) => {
      if (!cancelled) setFiles(f)
    })
    return () => {
      cancelled = true
    }
  }, [hasFiles])

  // Full ShareData for passing to handlers (combines meta + files)
  const shareData: ShareData = useMemo(() => ({ title, text, url, files }), [title, text, url, files])

  // Build a preview of what's being shared
  const sharedPreview = useMemo(() => {
    const parts: string[] = []
    if (title) parts.push(title)
    if (text && text !== title) parts.push(text)
    if (url) parts.push(url)
    return parts.join(" — ") || null
  }, [title, text, url])

  const filesSummary = useMemo(() => {
    if (!hasFiles && files.length === 0) return null
    if (files.length === 0) return hasFiles ? "Loading files..." : null
    const imageCount = files.filter((f) => f.type.startsWith("image/")).length
    const otherCount = files.length - imageCount
    const parts: string[] = []
    if (imageCount > 0) parts.push(`${imageCount} image${imageCount > 1 ? "s" : ""}`)
    if (otherCount > 0) parts.push(`${otherCount} file${otherCount > 1 ? "s" : ""}`)
    return parts.join(", ")
  }, [hasFiles, files])

  const streams = useMemo(() => bootstrap?.streams ?? [], [bootstrap?.streams])
  const dmPeers = useMemo(() => bootstrap?.dmPeers ?? [], [bootstrap?.dmPeers])
  const users = useMemo(() => bootstrap?.users ?? [], [bootstrap?.users])

  const handleSelectStream = useCallback(
    async (streamId: string) => {
      try {
        await saveShareContent(workspaceId!, streamId, shareData)
      } catch (err) {
        // Navigate anyway — the draft won't be pre-populated but the user isn't stranded
        console.error("Failed to save shared content", err)
      }
      void clearShareTargetCache()
      navigate(`/w/${workspaceId}/s/${streamId}`, { replace: true })
    },
    [workspaceId, shareData, navigate, saveShareContent]
  )

  const handleNewScratchpad = useCallback(async () => {
    try {
      const result = await createShareDraft(workspaceId!, shareData)
      void clearShareTargetCache()
      navigate(result.path, { replace: true })
    } catch (err) {
      console.error("Failed to create share draft", err)
      navigate(`/w/${workspaceId}`, { replace: true })
    }
  }, [workspaceId, shareData, navigate, createShareDraft])

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const items = useMemo(() => {
    const lowerQuery = query.toLowerCase()
    const dmPeerByStreamId = new Map(dmPeers.map((peer) => [peer.streamId, peer.userId]))
    const usersById = new Map(users.map((u) => [u.id, u]))

    // "New scratchpad" always at the top
    const newScratchpadItem: QuickSwitcherItem = {
      id: "__new_scratchpad__",
      label: "New scratchpad",
      icon: Plus,
      description: "Create a new scratchpad with shared content",
      onSelect: handleNewScratchpad,
    }

    // Filter to navigable stream types
    const filteredStreams = streams.filter(
      (s) =>
        s.archivedAt == null &&
        (s.type === StreamTypes.SCRATCHPAD || s.type === StreamTypes.CHANNEL || s.type === StreamTypes.DM)
    )

    // Score and sort
    const scoreStream = (stream: Stream): number => {
      if (!query) return 0
      const name = (getStreamName(stream) ?? streamFallbackLabel(stream.type, "generic")).toLowerCase()
      if (name === lowerQuery) return 0
      if (name.startsWith(lowerQuery)) return 1
      if (name.includes(lowerQuery)) return 2
      return Infinity
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
        let avatarUrl: string | undefined
        if (stream.type === StreamTypes.DM) {
          const peerUserId = dmPeerByStreamId.get(stream.id)
          const peerUser = peerUserId ? usersById.get(peerUserId) : undefined
          avatarUrl = getAvatarUrl(workspaceId!, peerUser?.avatarUrl, 64)
        }

        const typeLabel = TYPE_LABELS[stream.type] ?? stream.type

        return {
          id: stream.id,
          label: getStreamName(stream) ?? streamFallbackLabel(stream.type, "generic"),
          description: typeLabel,
          icon: STREAM_ICONS[stream.type],
          avatarUrl,
          onSelect: () => handleSelectStream(stream.id),
        }
      })

    return [newScratchpadItem, ...streamItems]
  }, [streams, dmPeers, users, query, workspaceId, handleNewScratchpad, handleSelectStream])

  const isLoading = !bootstrap && !bootstrapError

  if (bootstrapError) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 px-4 text-center">
          <p className="text-sm text-destructive">Failed to load workspace data.</p>
          <Button variant="link" onClick={() => navigate(`/w/${workspaceId}`, { replace: true })}>
            Go to workspace
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="w-full max-w-lg flex flex-col max-h-[80dvh]">
        {/* Header */}
        <div className="px-4 pt-6 pb-4">
          <h1 className="text-lg font-medium">Share to Threa</h1>

          {/* Text preview */}
          {sharedPreview && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
              <LinkIcon className="h-4 w-4 shrink-0 mt-0.5 opacity-60" />
              <span className="line-clamp-2 break-all">{sharedPreview}</span>
            </div>
          )}

          {/* File preview */}
          {filesSummary && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
              {files.some((f) => f.type.startsWith("image/")) ? (
                <Image className="h-4 w-4 shrink-0 mt-0.5 opacity-60" />
              ) : (
                <Paperclip className="h-4 w-4 shrink-0 mt-0.5 opacity-60" />
              )}
              <span>{filesSummary}</span>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search streams..."
              className="pl-9"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1))
                } else if (e.key === "ArrowUp") {
                  e.preventDefault()
                  setSelectedIndex((prev) => Math.max(prev - 1, 0))
                } else if (e.key === "Enter") {
                  e.preventDefault()
                  const item = items[selectedIndex]
                  if (item) item.onSelect()
                }
              }}
            />
          </div>
        </div>

        {/* Stream list */}
        <div className="flex-1 min-h-0 overflow-y-auto border-t border-border">
          <ItemList
            items={items}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            onSelectItem={(item) => item.onSelect()}
            isLoading={isLoading}
            emptyMessage="No streams found."
          />
        </div>
      </div>
    </div>
  )
}
