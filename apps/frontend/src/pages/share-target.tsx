import { useEffect, useRef } from "react"
import { Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@/auth"
import { useWorkspaces } from "@/hooks"
import { ThreaLogo } from "@/components/threa-logo"

/**
 * PWA Share Target entry point.
 *
 * When a user shares content to Threa from another app (via the Web Share Target API),
 * the browser navigates here with `?title=...&text=...&url=...` query params.
 *
 * This page resolves the user's workspace and redirects into the workspace-scoped
 * share picker at `/w/:workspaceId/share?...` where the full stream list is available.
 */
export function ShareTargetPage() {
  const { user, loading: authLoading } = useAuth()
  const { workspaces, isLoading: workspacesLoading } = useWorkspaces()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const hasNavigated = useRef(false)

  useEffect(() => {
    if (authLoading || workspacesLoading || hasNavigated.current) return
    if (!workspaces?.length) return

    hasNavigated.current = true

    // Use the first workspace (most users have exactly one)
    const workspaceId = workspaces[0].id
    navigate(`/w/${workspaceId}/share?${searchParams.toString()}`, { replace: true })
  }, [authLoading, workspacesLoading, workspaces, searchParams, navigate])

  // Redirect to login if not authenticated
  if (!authLoading && !user) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(`/share?${searchParams.toString()}`)}`} replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <ThreaLogo size="lg" className="animate-pulse" />
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    </div>
  )
}
