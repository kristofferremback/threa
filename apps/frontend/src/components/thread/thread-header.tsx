import { Link } from "react-router-dom"
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
}

export function ThreadHeader({ workspaceId, stream, onBack }: ThreadHeaderProps) {
  const { ancestors } = useThreadAncestors(workspaceId, stream.id, stream.parentStreamId, stream.rootStreamId)

  const backButton = onBack ? (
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
      <ChevronLeft className="h-4 w-4" />
    </Button>
  ) : stream.parentStreamId ? (
    <Link to={`/w/${workspaceId}/s/${stream.parentStreamId}`}>
      <Button variant="ghost" size="icon" className="h-8 w-8">
        <ChevronLeft className="h-4 w-4" />
      </Button>
    </Link>
  ) : null

  return (
    <div className="flex items-center gap-1 min-w-0">
      {backButton}
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {/* Ancestor breadcrumb items */}
          {ancestors.map((ancestor, index) => {
            const isLast = index === ancestors.length - 1
            const displayName = ancestor.slug ? `#${ancestor.slug}` : ancestor.displayName || "..."

            return (
              <div key={ancestor.id} className="contents">
                <BreadcrumbItem className="max-w-[120px]">
                  {!isLast ? (
                    <BreadcrumbLink asChild>
                      <Link to={`/w/${workspaceId}/s/${ancestor.id}`} className="truncate block">
                        {displayName}
                      </Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to={`/w/${workspaceId}/s/${ancestor.id}`} className="truncate block">
                        {ancestor.type === "thread" ? "Thread" : displayName}
                      </Link>
                    </BreadcrumbLink>
                  )}
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
