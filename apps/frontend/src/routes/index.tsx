import { createBrowserRouter, Navigate } from "react-router-dom"
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

// Simple workspace home that redirects to first available stream
function WorkspaceHome() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <p>Select a stream from the sidebar</p>
    </div>
  )
}
