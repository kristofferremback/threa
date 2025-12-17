import { createBrowserRouter, Navigate } from "react-router-dom"
import { LoginPage } from "@/pages/login"
import { WorkspaceSelectPage } from "@/pages/workspace-select"
import { WorkspaceLayout } from "@/pages/workspace-layout"
import { StreamPage } from "@/pages/stream"

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/workspaces" replace />,
  },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/workspaces",
    element: <WorkspaceSelectPage />,
  },
  {
    path: "/w/:workspaceId",
    element: <WorkspaceLayout />,
    children: [
      {
        index: true,
        // Workspace home - will redirect to scratchpad or show empty state
        element: <WorkspaceHome />,
      },
      {
        path: "s/:streamId",
        element: <StreamPage />,
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
