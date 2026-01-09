import { Link } from "react-router-dom"
import { Unlink, ShieldX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"

interface StreamErrorPageProps {
  workspaceId: string
  type: "not-found" | "forbidden"
}

export function StreamErrorPage({ workspaceId, type }: StreamErrorPageProps) {
  const config = {
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
  }

  const { icon: Icon, title, description } = config[type]

  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <Link to={`/w/${workspaceId}`}>Return to Workspace</Link>
        </Button>
        <Link to="/workspaces" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          Back to all workspaces
        </Link>
      </EmptyContent>
    </Empty>
  )
}

/** @deprecated Use StreamErrorPage with type="not-found" instead */
export function StreamNotFoundPage({ workspaceId }: { workspaceId: string }) {
  return <StreamErrorPage workspaceId={workspaceId} type="not-found" />
}
