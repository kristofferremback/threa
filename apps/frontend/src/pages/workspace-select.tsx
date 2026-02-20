import { useState } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { useAuth } from "@/auth"
import { useWorkspaces, useCreateWorkspace } from "@/hooks"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ThreaLogo } from "@/components/threa-logo"
import { ApiError } from "@/api/client"

function getCreateWorkspaceErrorMessage(error: unknown): string | null {
  if (!error) return null
  if (ApiError.isApiError(error) && error.status === 403) {
    return "Workspace creation requires a dedicated workspace invite."
  }
  if (error instanceof Error) {
    return error.message
  }
  return "Failed to create workspace"
}

export function WorkspaceSelectPage() {
  const { user, loading: authLoading } = useAuth()
  const { data: workspaces, isLoading: workspacesLoading, error } = useWorkspaces()
  const createWorkspace = useCreateWorkspace()
  const navigate = useNavigate()
  const [newWorkspaceName, setNewWorkspaceName] = useState("")
  const createWorkspaceErrorMessage = getCreateWorkspaceErrorMessage(createWorkspace.error)

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newWorkspaceName.trim()
    if (!name) return

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    const workspace = await createWorkspace.mutateAsync({ name, slug })
    navigate(`/w/${workspace.id}`)
  }

  // Redirect to login if not authenticated
  if (!authLoading && !user) {
    return <Navigate to="/login" replace />
  }

  const isLoading = authLoading || workspacesLoading

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <ThreaLogo size="lg" className="animate-pulse" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
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

  if (workspaces?.length === 1) {
    return <Navigate to={`/w/${workspaces[0].id}`} replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-8">
        <ThreaLogo size="lg" />
        <div className="text-center">
          <h1 className="text-xl font-medium">Welcome, {user?.name || "User"}</h1>
          <p className="mt-1 text-muted-foreground text-sm">Select a workspace to continue</p>
        </div>
        {workspaces && workspaces.length > 0 && (
          <div className="flex flex-col gap-2">
            {workspaces.map((workspace) => (
              <Button key={workspace.id} asChild variant="outline" className="w-64 justify-start">
                <Link to={`/w/${workspace.id}`}>
                  <span className="truncate">{workspace.name}</span>
                </Link>
              </Button>
            ))}
          </div>
        )}

        <form onSubmit={handleCreateWorkspace} className="flex flex-col gap-3 w-64">
          <Input
            type="text"
            placeholder="New workspace name"
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            disabled={createWorkspace.isPending}
          />
          <Button type="submit" disabled={!newWorkspaceName.trim() || createWorkspace.isPending}>
            {createWorkspace.isPending ? "Creating..." : "Create Workspace"}
          </Button>
          {createWorkspaceErrorMessage && <p className="text-sm text-destructive">{createWorkspaceErrorMessage}</p>}
        </form>
      </div>
    </div>
  )
}
