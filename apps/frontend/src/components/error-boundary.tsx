import { useRouteError, isRouteErrorResponse, Link } from "react-router-dom"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"

export function ErrorBoundary() {
  const error = useRouteError()

  let title = "Something Went Wrong"
  let description = "The labyrinth has shifted unexpectedly. We encountered an error while navigating your path."

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Path Not Found"
      description = "The thread you seek does not exist in this labyrinth."
    } else if (error.status === 403) {
      title = "Access Denied"
      description = "The gates to this part of the labyrinth are sealed."
    }
  }

  const handleReload = () => {
    window.location.reload()
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertTriangle />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex gap-2">
            <Button onClick={handleReload}>Try Again</Button>
            <Button variant="outline" asChild>
              <Link to="/workspaces">Back to Workspaces</Link>
            </Button>
          </div>
          {import.meta.env.DEV && error instanceof Error && (
            <details className="mt-4 max-w-md text-left">
              <summary className="cursor-pointer text-sm text-muted-foreground">Error details (dev only)</summary>
              <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
                {error.message}
                {error.stack && `\n\n${error.stack}`}
              </pre>
            </details>
          )}
        </EmptyContent>
      </Empty>
    </div>
  )
}
