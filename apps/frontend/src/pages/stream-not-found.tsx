import { Link } from "react-router-dom"
import { Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"

interface StreamNotFoundPageProps {
  workspaceId: string
}

export function StreamNotFoundPage({ workspaceId }: StreamNotFoundPageProps) {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Unlink />
        </EmptyMedia>
        <EmptyTitle>The Thread Has Broken</EmptyTitle>
        <EmptyDescription>
          The path you seek has faded into the labyrinth. Perhaps the stream was archived, or the thread was never spun.
        </EmptyDescription>
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
