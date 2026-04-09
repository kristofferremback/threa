import { useEffect, useRef } from "react"
import { createBrowserRouter, Navigate, useLocation, useParams } from "react-router-dom"
import { LoginPage } from "@/pages/login"
import { WorkspaceSelectPage } from "@/pages/workspace-select"
import { WorkspaceLayout } from "@/pages/workspace-layout"
import { StreamPage } from "@/pages/stream"
import { DraftsPage } from "@/pages/drafts"
import { ThreadsPage } from "@/pages/threads"
import { ActivityPage } from "@/pages/activity"
import { MemoryPage } from "@/pages/memory"
import { AIUsageAdminPage } from "@/pages/ai-usage-admin"
import { UserSetupPage } from "@/pages/user-setup"
import { ShareTargetPage } from "@/pages/share-target"
import { SharePickerPage } from "@/pages/share-picker"
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
    path: "/share",
    element: <ShareTargetPage />,
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
        path: "memory",
        element: <MemoryPage />,
      },
      {
        path: "memos/:memoId",
        element: <LegacyMemoRedirect />,
      },
      {
        path: "s/:streamId",
        element: <StreamPage />,
      },
      {
        path: "share",
        element: <SharePickerPage />,
      },
      {
        path: "admin/ai-usage",
        element: <AIUsageAdminPage />,
      },
    ],
  },
])

/** Workspace index route — redirects to a stream or opens the sidebar. */
export function WorkspaceHome() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const location = useLocation()
  const { state, togglePinned } = useSidebar()
  const { redirectStreamId, shouldOpenSidebar } = useLastStream(workspaceId ?? "")
  const sidebarOpenedRef = useRef(false)

  useEffect(() => {
    if (shouldOpenSidebar && state === "collapsed" && !sidebarOpenedRef.current) {
      sidebarOpenedRef.current = true
      togglePinned()
    }
  }, [shouldOpenSidebar, state, togglePinned])

  if (redirectStreamId && workspaceId) {
    return (
      <Navigate
        to={{
          pathname: `/w/${workspaceId}/s/${redirectStreamId}`,
          search: location.search,
        }}
        replace
      />
    )
  }

  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <p>Select a stream from the sidebar</p>
    </div>
  )
}

export function LegacyMemoRedirect() {
  const { workspaceId, memoId } = useParams<{ workspaceId: string; memoId: string }>()
  const location = useLocation()

  if (!workspaceId || !memoId) {
    return <Navigate to="/workspaces" replace />
  }

  const params = new URLSearchParams(location.search)
  params.set("memo", memoId)

  return (
    <Navigate
      to={{
        pathname: `/w/${workspaceId}/memory`,
        search: `?${params.toString()}`,
      }}
      replace
    />
  )
}
