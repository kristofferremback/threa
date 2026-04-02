import { useRouteError, isRouteErrorResponse, Link } from "react-router-dom"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"
import { ErrorDetails } from "./error-details"

function formatError(error: unknown): string | null {
  if (error instanceof Error) {
    return error.stack ?? error.message
  }
  if (isRouteErrorResponse(error)) {
    const data = typeof error.data === "string" ? error.data : JSON.stringify(error.data, null, 2)
    return `${error.status} ${error.statusText}\n${data}`
  }
  if (error != null) {
    try {
      return JSON.stringify(error, null, 2)
    } catch {
      return String(error)
    }
  }
  return null
}

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

  const errorText = formatError(error)

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background p-4">
      <Empty className="border-0 max-w-md w-full">
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
          {errorText && <ErrorDetails text={errorText} />}
        </EmptyContent>
      </Empty>
    </div>
  )
}
