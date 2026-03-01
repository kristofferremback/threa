import { useEffect } from "react"
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
import { useSidebar } from "@/contexts"
import { useLastStream } from "@/hooks"

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

/** Workspace index route — redirects to a stream or opens the sidebar. */
function WorkspaceHome() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { state, togglePinned } = useSidebar()
  const { redirectStreamId, shouldOpenSidebar } = useLastStream(workspaceId ?? "")

  useEffect(() => {
    if (shouldOpenSidebar && state === "collapsed") {
      togglePinned()
    }
  }, [shouldOpenSidebar, state, togglePinned])

  if (redirectStreamId && workspaceId) {
    return <Navigate to={`/w/${workspaceId}/s/${redirectStreamId}`} replace />
  }

  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <p>Select a stream from the sidebar</p>
    </div>
  )
}
