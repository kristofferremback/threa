import { Link, Navigate } from "react-router-dom"
import { useAuth } from "@/auth"
import { useWorkspaces } from "@/hooks"
import { Button } from "@/components/ui/button"

export function WorkspaceSelectPage() {
  const { user, loading: authLoading } = useAuth()
  const { data: workspaces, isLoading: workspacesLoading, error } = useWorkspaces()

  // Redirect to login if not authenticated
  if (!authLoading && !user) {
    return <Navigate to="/login" replace />
  }

  const isLoading = authLoading || workspacesLoading

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-destructive">Failed to load workspaces</p>
          <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome, {user?.name || "User"}</h1>
          <p className="mt-2 text-muted-foreground">Select a workspace to continue</p>
        </div>
        <div className="flex flex-col gap-2">
          {workspaces && workspaces.length > 0 ? (
            workspaces.map((workspace) => (
              <Button key={workspace.id} asChild variant="outline" className="w-64 justify-start">
                <Link to={`/w/${workspace.id}`}>
                  <span className="truncate">{workspace.name}</span>
                </Link>
              </Button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No workspaces yet</p>
          )}
        </div>
      </div>
    </div>
  )
}
