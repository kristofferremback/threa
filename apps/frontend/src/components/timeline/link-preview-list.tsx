import { useState, useCallback, useEffect, useMemo } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { linkPreviewsApi } from "@/api"
import { cn } from "@/lib/utils"
import { usePreferences } from "@/contexts/preferences-context"
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

  // Update previews when they arrive from props (real-time socket delivery)
  useEffect(() => {
    if (initialPreviews && initialPreviews.length > 0) {
      setPreviews(initialPreviews)
    }
  }, [initialPreviews])

  // Fetch previews from API if none provided via props
  useEffect(() => {
    if (previews.length > 0 || fetchedFromApi) return

    let mounted = true
    async function fetchPreviews() {
      try {
        const result = await linkPreviewsApi.getForMessage(workspaceId, messageId)
        if (!mounted) return
        setPreviews(result.map(({ dismissed, ...p }) => p))
        setDismissedIds(new Set(result.filter((p) => p.dismissed).map((p) => p.id)))
        setFetchedFromApi(true)
      } catch {
        // Silently fail — previews are non-critical
      }
    }

    fetchPreviews()
    return () => {
      mounted = false
    }
  }, [workspaceId, messageId, previews.length, fetchedFromApi])

  const handleDismiss = useCallback(
    async (previewId: string) => {
      setDismissedIds((prev) => new Set([...prev, previewId]))
      try {
        await linkPreviewsApi.dismiss(workspaceId, previewId, messageId)
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

        // Respect default collapsed preference unless user has explicitly toggled
        const isCollapsed = collapsedIds.has(preview.id)
          ? true
          : defaultCollapsed && !collapsedIds.has(`__opened_${preview.id}`)

        return (
          <LinkPreviewCard
            key={preview.id}
            preview={preview}
            isHighlighted={isHighlighted}
            isCollapsed={isCollapsed}
            onDismiss={handleDismiss}
            onToggleCollapse={(id) => {
              // Track explicit user toggle
              setCollapsedIds((prev) => {
                const next = new Set(prev)
                if (next.has(id)) {
                  next.delete(id)
                  // Mark as explicitly opened (for default-collapsed mode)
                  next.add(`__opened_${id}`)
                } else {
                  next.add(id)
                  next.delete(`__opened_${id}`)
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
