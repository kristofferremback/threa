import { Link } from "react-router-dom"
import { Unlink, ShieldX, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"
import type { StreamErrorType } from "@/hooks/use-stream-error"

const ERROR_CONFIG = {
  "not-found": {
    icon: Unlink,
    title: "The Thread Has Broken",
    description:
      "The path you seek has faded into the labyrinth. Perhaps the stream was archived, or the thread was never spun.",
  },
  forbidden: {
    icon: ShieldX,
    title: "Access Denied",
    description: "You don't have permission to view this stream. The path exists, but the gates are closed to you.",
  },
  error: {
    icon: AlertTriangle,
    title: "Something Went Wrong",
    description: "We couldn't load this stream. Please refresh the page or try again later.",
  },
} as const

interface StreamErrorViewProps {
  type: StreamErrorType
  /** If provided, shows navigation buttons to return to workspace */
  workspaceId?: string
}

/**
 * Displays a stream error (404/403/generic) with optional navigation back to workspace.
 * Used both for embedded contexts (side panels) and full-page errors.
 */
export function StreamErrorView({ type, workspaceId }: StreamErrorViewProps) {
  const { icon: Icon, title, description } = ERROR_CONFIG[type]

  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {workspaceId && (
        <EmptyContent>
          <Button asChild>
            <Link to={`/w/${workspaceId}`}>Return to Workspace</Link>
          </Button>
          <Link to="/workspaces" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Back to all workspaces
          </Link>
        </EmptyContent>
      )}
    </Empty>
  )
}
