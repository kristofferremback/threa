import { Link } from "react-router-dom"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useStreamBootstrap } from "@/hooks"

interface ThreadHeaderStream {
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
  const rootStreamId = stream.rootStreamId
  const parentStreamId = stream.parentStreamId

  // Fetch root stream to get its display name
  const { data: rootBootstrap } = useStreamBootstrap(workspaceId, rootStreamId ?? "", {
    enabled: !!rootStreamId,
  })
  const rootStream = rootBootstrap?.stream
  const rootStreamName = rootStream?.slug ? `#${rootStream.slug}` : rootStream?.displayName

  const backButton = onBack ? (
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
      <ChevronLeft className="h-4 w-4" />
    </Button>
  ) : parentStreamId ? (
    <Link to={`/w/${workspaceId}/s/${parentStreamId}`}>
      <Button variant="ghost" size="icon" className="h-8 w-8">
        <ChevronLeft className="h-4 w-4" />
      </Button>
    </Link>
  ) : null

  return (
    <div className="flex items-center gap-1">
      {backButton}
      <h1 className="font-semibold">
        Thread in{" "}
        {rootStreamId ? (
          <Link to={`/w/${workspaceId}/s/${rootStreamId}`} className="text-primary hover:underline">
            {rootStreamName || "..."}
          </Link>
        ) : (
          "..."
        )}
      </h1>
    </div>
  )
}
