import { useEffect, useRef } from "react"
import { Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@/auth"
import { useWorkspaces } from "@/hooks"
import { useShareTarget } from "@/hooks/use-share-target"
import { ThreaLogo } from "@/components/threa-logo"

/**
 * PWA Share Target page.
 *
 * When a user shares content to Threa from another app (via the Web Share Target API),
 * the browser navigates here with `?title=...&text=...&url=...` query params.
 *
 * This page creates a new draft scratchpad pre-populated with the shared content,
 * then redirects the user into that scratchpad.
 */
export function ShareTargetPage() {
  const { user, loading: authLoading } = useAuth()
  const { workspaces, isLoading: workspacesLoading } = useWorkspaces()
  const { createShareDraft } = useShareTarget()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const hasNavigated = useRef(false)

  const title = searchParams.get("title")
  const text = searchParams.get("text")
  const url = searchParams.get("url")

  useEffect(() => {
    if (authLoading || workspacesLoading || hasNavigated.current) return
    if (!workspaces?.length) return

    hasNavigated.current = true

    // Use the first workspace (most users have exactly one)
    const workspaceId = workspaces[0].id

    createShareDraft(workspaceId, { title, text, url }).then(({ path }) => {
      navigate(path, { replace: true })
    })
  }, [authLoading, workspacesLoading, workspaces, title, text, url, navigate, createShareDraft])

  // Redirect to login if not authenticated
  if (!authLoading && !user) {
    // Preserve the share params so the user lands back here after login
    return <Navigate to={`/login?redirect=${encodeURIComponent(`/share?${searchParams.toString()}`)}`} replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <ThreaLogo size="lg" className="animate-pulse" />
        <p className="text-muted-foreground text-sm">Saving to Threa...</p>
      </div>
    </div>
  )
}
