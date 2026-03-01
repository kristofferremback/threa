import { useEffect, useMemo } from "react"
import { createBrowserRouter, Navigate, useParams } from "react-router-dom"
import { LoginPage } from "@/pages/login"
import { WorkspaceSelectPage } from "@/pages/workspace-select"
import { WorkspaceLayout } from "@/pages/workspace-layout"
import { StreamPage } from "@/pages/stream"
import { DraftsPage } from "@/pages/drafts"
import { ThreadsPage } from "@/pages/threads"
import { ActivityPage } from "@/pages/activity"
import { AIUsageAdminPage } from "@/pages/ai-usage-admin"
import { UserSetupPage } from "@/pages/user-setup"
import { ErrorBoundary } from "@/components/error-boundary"
import { useAuth } from "@/auth"
import { useSidebar } from "@/contexts"
import { useWorkspaceBootstrap } from "@/hooks"
import { getLastStreamId } from "@/lib/last-stream"

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/workspaces" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: "/login",
    element: <LoginPage />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: "/workspaces",
    element: <WorkspaceSelectPage />,
    errorElement: <ErrorBoundary />,
  },
  {
    // Setup page lives outside WorkspaceLayout — it's a lightweight form that
    // doesn't need the full workspace bootstrap (socket, sidebar, etc.)
    path: "/w/:workspaceId/setup",
    element: <UserSetupPage />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: "/w/:workspaceId",
    element: <WorkspaceLayout />,
    errorElement: <ErrorBoundary />,
    children: [
      {
        index: true,
        element: <WorkspaceHome />,
      },
      {
        path: "drafts",
        element: <DraftsPage />,
      },
      {
        path: "threads",
        element: <ThreadsPage />,
      },
      {
        path: "activity",
        element: <ActivityPage />,
      },
      {
        path: "s/:streamId",
        element: <StreamPage />,
      },
      {
        path: "admin/ai-usage",
        element: <AIUsageAdminPage />,
      },
    ],
  },
])

/**
 * Workspace index route — restores the user's last-opened stream.
 *
 * Priority:
 * 1. localStorage last-stream (scoped to user + workspace)
 * 2. Most recently active stream from bootstrap data
 * 3. First available stream
 * 4. Auto-open sidebar (empty workspace only)
 */
function WorkspaceHome() {
  const { user } = useAuth()
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { state, togglePinned } = useSidebar()
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId ?? "")

  const lastStreamId = user && workspaceId ? getLastStreamId(user.id, workspaceId) : null

  // Fall back to most recently active stream from bootstrap
  const fallbackStreamId = useMemo(() => {
    if (lastStreamId || !bootstrap?.streams.length) return null
    const withPreview = bootstrap.streams
      .filter((s) => s.lastMessagePreview)
      .sort((a, b) => b.lastMessagePreview!.createdAt.localeCompare(a.lastMessagePreview!.createdAt))
    return withPreview[0]?.id ?? bootstrap.streams[0]?.id ?? null
  }, [lastStreamId, bootstrap])

  const redirectStreamId = lastStreamId ?? fallbackStreamId

  // Auto-open sidebar when workspace has no streams at all
  useEffect(() => {
    if (!redirectStreamId && state === "collapsed") {
      togglePinned()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount only

  if (redirectStreamId && workspaceId) {
    return <Navigate to={`/w/${workspaceId}/s/${redirectStreamId}`} replace />
  }

  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <p>Select a stream from the sidebar</p>
    </div>
  )
}
