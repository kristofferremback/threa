import { useState, useCallback, useEffect, useMemo } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { linkPreviewsApi } from "@/api"
import { cn } from "@/lib/utils"
import { usePreferences, useSocket } from "@/contexts"
import { LinkPreviewCard } from "./link-preview-card"
import type { LinkPreviewSummary } from "@threa/types"

/** Number of previews shown before the "show more" expansion */
const DEFAULT_VISIBLE_COUNT = 3

interface LinkPreviewListProps {
  messageId: string
  workspaceId: string
  /** Previews provided from stream event payload (real-time) */
  previews?: LinkPreviewSummary[]
  /** Currently hovered link URL from inline text */
  hoveredUrl?: string | null
  className?: string
}

export function LinkPreviewList({
  messageId,
  workspaceId,
  previews: initialPreviews,
  hoveredUrl,
  className,
}: LinkPreviewListProps) {
  const [previews, setPreviews] = useState<LinkPreviewSummary[]>(initialPreviews ?? [])
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [isExpanded, setIsExpanded] = useState(false)
  const [fetchedFromApi, setFetchedFromApi] = useState(false)
  const { preferences } = usePreferences()

  const defaultCollapsed = preferences?.linkPreviewDefault === "collapsed"

  // Track whether socket has delivered previews (takes priority over API fetch)
  const [hasSocketPreviews, setHasSocketPreviews] = useState(
    () => initialPreviews !== undefined && initialPreviews.length > 0
  )

  // Update previews when they arrive from props (real-time socket delivery)
  useEffect(() => {
    if (initialPreviews && initialPreviews.length > 0) {
      setPreviews(initialPreviews)
      setHasSocketPreviews(true)
    }
  }, [initialPreviews])

  // Fetch previews (and dismissal flags) from API.
  // Always runs on mount to hydrate dismissedIds, even when previews came from IndexedDB cache.
  useEffect(() => {
    if (fetchedFromApi) return

    let mounted = true
    linkPreviewsApi
      .getForMessage(workspaceId, messageId)
      .then((result) => {
        if (!mounted) return
        if (!hasSocketPreviews) {
          setPreviews(result.map(({ dismissed, ...p }) => p))
        }
        setDismissedIds(new Set(result.filter((p) => p.dismissed).map((p) => p.id)))
        setFetchedFromApi(true)
      })
      .catch(() => {
        // Silently fail — previews are non-critical
      })
    return () => {
      mounted = false
    }
  }, [workspaceId, messageId, fetchedFromApi])

  // Sync dismissals from other views/tabs via socket (author-scoped event)
  const socket = useSocket()
  useEffect(() => {
    if (!socket) return
    const handler = (payload: { messageId: string; linkPreviewId: string }) => {
      if (payload.messageId !== messageId) return
      setDismissedIds((prev) => {
        if (prev.has(payload.linkPreviewId)) return prev
        return new Set([...prev, payload.linkPreviewId])
      })
    }
    socket.on("link_preview:dismissed", handler)
    return () => {
      socket.off("link_preview:dismissed", handler)
    }
  }, [socket, messageId])

  const handleDismiss = useCallback(
    async (previewId: string) => {
      setDismissedIds((prev) => new Set([...prev, previewId]))
      try {
        await linkPreviewsApi.dismiss(workspaceId, messageId, previewId)
      } catch {
        // Revert on failure
        setDismissedIds((prev) => {
          const next = new Set(prev)
          next.delete(previewId)
          return next
        })
      }
    },
    [workspaceId, messageId]
  )

  // Filter out dismissed previews
  const visiblePreviews = useMemo(() => previews.filter((p) => !dismissedIds.has(p.id)), [previews, dismissedIds])

  if (visiblePreviews.length === 0) return null

  const displayedPreviews = isExpanded ? visiblePreviews : visiblePreviews.slice(0, DEFAULT_VISIBLE_COUNT)
  const hiddenCount = visiblePreviews.length - DEFAULT_VISIBLE_COUNT

  return (
    <div className={cn("flex flex-col gap-2 mt-2", className)}>
      {displayedPreviews.map((preview) => {
        // Determine if this preview corresponds to the hovered inline link
        const isHighlighted = hoveredUrl ? normalizeForCompare(preview.url) === normalizeForCompare(hoveredUrl) : false

        // Collapsed if explicitly collapsed, or default-collapsed and not explicitly opened
        const explicitlyCollapsed = collapsedIds.has(preview.id)
        const explicitlyOpened = collapsedIds.has(`__opened_${preview.id}`)
        const isCollapsed = explicitlyCollapsed || (defaultCollapsed && !explicitlyOpened)

        return (
          <LinkPreviewCard
            key={preview.id}
            preview={preview}
            isHighlighted={isHighlighted}
            isCollapsed={isCollapsed}
            onDismiss={handleDismiss}
            onToggleCollapse={(id) => {
              setCollapsedIds((prev) => {
                const next = new Set(prev)
                // Determine current effective collapsed state
                const currentlyCollapsed = next.has(id) || (defaultCollapsed && !next.has(`__opened_${id}`))
                // Clear both markers, then set the opposite
                next.delete(id)
                next.delete(`__opened_${id}`)
                if (currentlyCollapsed) {
                  next.add(`__opened_${id}`)
                } else {
                  next.add(id)
                }
                return next
              })
            }}
          />
        )
      })}

      {hiddenCount > 0 && !isExpanded && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start h-7 text-xs text-muted-foreground"
          onClick={() => setIsExpanded(true)}
        >
          <ChevronDown className="h-3 w-3 mr-1" />
          Show {hiddenCount} more preview{hiddenCount > 1 ? "s" : ""}
        </Button>
      )}
    </div>
  )
}

/** Normalize URL for hover comparison (strip trailing slash, lowercase) */
function normalizeForCompare(url: string): string {
  try {
    const u = new URL(url)
    u.hostname = u.hostname.toLowerCase()
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1)
    }
    return u.toString()
  } catch {
    return url.toLowerCase()
  }
}
