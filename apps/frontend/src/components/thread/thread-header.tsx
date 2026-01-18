import { Link, useParams } from "react-router-dom"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { useThreadAncestors } from "@/hooks"
import { usePanel } from "@/contexts"

interface ThreadHeaderStream {
  id: string
  parentStreamId: string | null
  rootStreamId: string | null
}

interface ThreadHeaderProps {
  workspaceId: string
  stream: ThreadHeaderStream
  /** Custom back action. If not provided, navigates to parent stream. */
  onBack?: () => void
  /** Whether this header is in a panel (true) or main view (false). Affects navigation behavior. */
  inPanel?: boolean
}

export function ThreadHeader({ workspaceId, stream, onBack, inPanel = false }: ThreadHeaderProps) {
  const { ancestors } = useThreadAncestors(workspaceId, stream.id, stream.parentStreamId, stream.rootStreamId)
  const { getPanelUrl, closePanel } = usePanel()
  const { streamId: mainViewStreamId } = useParams<{ streamId: string }>()

  // Generate URL based on context - panel stays in panel, main view stays in main view
  const getNavigationUrl = (streamId: string) => {
    return inPanel ? getPanelUrl(streamId) : `/w/${workspaceId}/s/${streamId}`
  }

  // Check if a stream is the main view stream (to avoid duplicating it in panel)
  const isMainViewStream = (streamId: string) => {
    return inPanel && mainViewStreamId === streamId
  }

  const backButton = onBack ? (
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
      <ChevronLeft className="h-4 w-4" />
    </Button>
  ) : stream.parentStreamId ? (
    isMainViewStream(stream.parentStreamId) ? (
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={closePanel}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
    ) : (
      <Link to={getNavigationUrl(stream.parentStreamId)}>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </Link>
    )
  ) : null

  return (
    <div className="flex items-center gap-1 min-w-0">
      {backButton}
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {/* Ancestor breadcrumb items */}
          {ancestors.map((ancestor) => {
            // For threads with no name, show "Thread"
            // For channels, show #slug
            // For other types, show displayName
            const displayName =
              ancestor.type === "thread"
                ? ancestor.displayName || "Thread"
                : ancestor.slug
                  ? `#${ancestor.slug}`
                  : ancestor.displayName || "..."

            // If this ancestor is the main view stream, close panel instead of navigating
            if (isMainViewStream(ancestor.id)) {
              return (
                <div key={ancestor.id} className="contents">
                  <BreadcrumbItem className="max-w-[120px]">
                    <BreadcrumbLink asChild>
                      <button
                        onClick={closePanel}
                        className="truncate block text-left hover:underline cursor-pointer bg-transparent border-0 p-0 font-inherit"
                      >
                        {displayName}
                      </button>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                </div>
              )
            }

            return (
              <div key={ancestor.id} className="contents">
                <BreadcrumbItem className="max-w-[120px]">
                  <BreadcrumbLink asChild>
                    <Link to={getNavigationUrl(ancestor.id)} className="truncate block">
                      {displayName}
                    </Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </div>
            )
          })}
          {/* Current thread */}
          <BreadcrumbItem>
            <BreadcrumbPage className="truncate">Thread</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  )
}
