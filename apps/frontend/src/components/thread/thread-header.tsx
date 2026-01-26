import { useRef, useState, useEffect, useMemo } from "react"
import { Link, useParams } from "react-router-dom"
import { ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useThreadAncestors, useWorkspaceBootstrap } from "@/hooks"
import { usePanel } from "@/contexts"
import { AncestorBreadcrumbItem } from "./breadcrumb-helpers"
import { BreadcrumbEllipsisDropdown } from "./breadcrumb-ellipsis-dropdown"

interface ThreadHeaderStream {
  id: string
  displayName: string | null
  parentStreamId: string | null
  rootStreamId: string | null
}

interface ThreadHeaderProps {
  workspaceId: string
  stream: ThreadHeaderStream
  /** Whether this header is in a panel (true) or main view (false). Affects navigation behavior. */
  inPanel?: boolean
}

/** Breakpoints for progressive breadcrumb reduction */
const BREAKPOINTS = {
  /** Below: only current thread name */
  MINIMAL: 200,
  /** Below: root > current */
  COMPACT: 300,
  /** Below: root + 1 ancestor > current */
  MEDIUM: 450,
  /** Above: show all or root + 2 ancestors > current */
  FULL: 600,
}

export function ThreadHeader({ workspaceId, stream, inPanel = false }: ThreadHeaderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(BREAKPOINTS.FULL)

  const { ancestors: hookAncestors, isLoading } = useThreadAncestors(
    workspaceId,
    stream.id,
    stream.parentStreamId,
    stream.rootStreamId
  )

  // Fallback: if ancestors is empty but we have rootStreamId, try to at least show the root
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId)
  const ancestors = useMemo(() => {
    if (hookAncestors.length > 0) return hookAncestors

    // Fallback: try to find root stream if parent chain failed
    if (stream.rootStreamId && bootstrap?.streams) {
      const rootStream = bootstrap.streams.find((s) => s.id === stream.rootStreamId)
      if (rootStream) {
        return [
          {
            id: rootStream.id,
            displayName: rootStream.displayName,
            slug: rootStream.slug,
            type: rootStream.type,
            parentStreamId: rootStream.parentStreamId,
          },
        ]
      }
    }

    return []
  }, [hookAncestors, stream.rootStreamId, bootstrap?.streams])

  const { openPanel, getPanelUrl, closePanel } = usePanel()
  const { streamId: mainViewStreamId } = useParams<{ streamId: string }>()

  // Measure container width for responsive breadcrumbs
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })

    observer.observe(container)
    setContainerWidth(container.offsetWidth)

    return () => observer.disconnect()
  }, [])

  // Generate URL based on context - panel stays in panel, main view stays in main view
  const getNavigationUrl = (streamId: string) => {
    return inPanel ? getPanelUrl(streamId) : `/w/${workspaceId}/s/${streamId}`
  }

  // Check if a stream is the main view stream (to avoid duplicating it in panel)
  const isMainViewStream = (streamId: string) => {
    return inPanel && mainViewStreamId === streamId
  }

  // Determine parent stream type for tooltip
  const parentType = ancestors.length > 0 ? ancestors[ancestors.length - 1].type : null
  const upTooltip = (() => {
    switch (parentType) {
      case "channel":
        return "Show channel"
      case "scratchpad":
        return "Show scratchpad"
      case "dm":
        return "Show DM"
      case "thread":
        return "Show parent thread"
      default:
        return "Show parent"
    }
  })()

  const handleGoUp = () => {
    if (!stream.parentStreamId) return
    if (inPanel) {
      // If parent is already the main view, just close the panel
      if (isMainViewStream(stream.parentStreamId)) {
        closePanel()
      } else {
        openPanel(stream.parentStreamId)
      }
    }
  }

  const upButton = stream.parentStreamId ? (
    <Tooltip>
      <TooltipTrigger asChild>
        {inPanel ? (
          <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={handleGoUp}>
            <ChevronUp className="h-4 w-4" />
          </Button>
        ) : (
          <Link to={getNavigationUrl(stream.parentStreamId)}>
            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
              <ChevronUp className="h-4 w-4" />
            </Button>
          </Link>
        )}
      </TooltipTrigger>
      <TooltipContent>{upTooltip}</TooltipContent>
    </Tooltip>
  ) : null

  // Progressive reduction: how many ancestors can we show?
  const maxVisibleAncestors = useMemo(() => {
    if (containerWidth < BREAKPOINTS.MINIMAL) return 0
    if (containerWidth < BREAKPOINTS.COMPACT) return 1
    if (containerWidth < BREAKPOINTS.MEDIUM) return 2
    if (containerWidth < BREAKPOINTS.FULL) return 3
    return Infinity
  }, [containerWidth])

  // Width budget: current thread gets priority, ancestors share the rest
  const { ancestorMaxWidth, currentMaxWidth } = useMemo(() => {
    // Fixed overhead: back button + close button (if panel) + flex gaps
    const fixedOverhead = 32 + (inPanel ? 32 : 0) + 16
    // Each visible ancestor has a separator (">" + spacing) after it
    const separatorWidth = 24

    const visibleAncestorCount = Math.min(ancestors.length, maxVisibleAncestors)
    const totalSeparators = visibleAncestorCount * separatorWidth
    const available = Math.max(0, containerWidth - fixedOverhead - totalSeparators)

    if (visibleAncestorCount === 0) {
      return { ancestorMaxWidth: 0, currentMaxWidth: Math.min(available, 300) }
    }

    // Current thread gets ~50% of remaining space (min 80px, max 200px)
    const currentShare = Math.min(200, Math.max(80, Math.floor(available * 0.5)))
    const ancestorBudget = available - currentShare
    const perAncestor = Math.max(40, Math.floor(ancestorBudget / visibleAncestorCount))

    return {
      ancestorMaxWidth: Math.min(perAncestor, 150),
      currentMaxWidth: currentShare,
    }
  }, [containerWidth, ancestors.length, maxVisibleAncestors, inPanel])

  // Render ancestor breadcrumbs with progressive ellipsis
  const renderBreadcrumbs = () => {
    if (ancestors.length === 0 || maxVisibleAncestors === 0) {
      return null
    }

    // All ancestors fit — show them all
    if (ancestors.length <= maxVisibleAncestors) {
      return ancestors.map((ancestor) => (
        <AncestorBreadcrumbItem
          key={ancestor.id}
          stream={ancestor}
          isMainViewStream={isMainViewStream(ancestor.id)}
          onClosePanel={closePanel}
          getNavigationUrl={getNavigationUrl}
          maxWidth={ancestorMaxWidth}
        />
      ))
    }

    // Too many: show first + ellipsis + last N
    const first = ancestors[0]
    const tailCount = Math.max(1, maxVisibleAncestors - 1)
    const hidden = ancestors.slice(1, ancestors.length - tailCount)
    const tail = ancestors.slice(ancestors.length - tailCount)

    return (
      <>
        <AncestorBreadcrumbItem
          stream={first}
          isMainViewStream={isMainViewStream(first.id)}
          onClosePanel={closePanel}
          getNavigationUrl={getNavigationUrl}
          maxWidth={ancestorMaxWidth}
        />
        {hidden.length > 0 && (
          <BreadcrumbEllipsisDropdown
            items={hidden}
            getNavigationUrl={getNavigationUrl}
            isMainViewStream={isMainViewStream}
            onClosePanel={closePanel}
          />
        )}
        {tail.map((ancestor) => (
          <AncestorBreadcrumbItem
            key={ancestor.id}
            stream={ancestor}
            isMainViewStream={isMainViewStream(ancestor.id)}
            onClosePanel={closePanel}
            getNavigationUrl={getNavigationUrl}
            maxWidth={ancestorMaxWidth}
          />
        ))}
      </>
    )
  }

  // Show loading placeholder if ancestors are loading and we expect some
  const showLoadingPlaceholder = isLoading && stream.parentStreamId && ancestors.length === 0

  return (
    <div
      ref={containerRef}
      className={`flex items-center gap-1 min-w-0 flex-1 overflow-hidden ${inPanel ? "pr-2" : ""}`}
    >
      {upButton}
      <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
        <BreadcrumbList className="flex-nowrap">
          {showLoadingPlaceholder ? (
            <>
              <BreadcrumbItem>
                <span className="text-muted-foreground text-sm">Loading...</span>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </>
          ) : (
            renderBreadcrumbs()
          )}
          {/* Current thread — gets priority width */}
          <BreadcrumbItem style={{ maxWidth: currentMaxWidth }}>
            <Tooltip>
              <TooltipTrigger asChild>
                <BreadcrumbPage className="truncate">{stream.displayName || "Thread"}</BreadcrumbPage>
              </TooltipTrigger>
              <TooltipContent>{stream.displayName || "Thread"}</TooltipContent>
            </Tooltip>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  )
}
