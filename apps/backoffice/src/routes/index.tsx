import { createBrowserRouter } from "react-router-dom"
import { ProtectedRoute } from "@/components/protected-route"
import { WelcomePage } from "@/pages/welcome"
import { InviteWorkspaceOwnerPage } from "@/pages/invite-workspace-owner"
import { WorkspacesPage } from "@/pages/workspaces"
import { WorkspaceDetailPage } from "@/pages/workspace-detail"
import { NotAuthorizedPage } from "@/pages/not-authorized"

export const router = createBrowserRouter([
  {
    path: "/not-authorized",
    element: <NotAuthorizedPage />,
  },
  {
    path: "/",
    element: <ProtectedRoute />,
    children: [
      { index: true, element: <WelcomePage /> },
      { path: "workspaces", element: <WorkspacesPage /> },
      { path: "workspaces/:id", element: <WorkspaceDetailPage /> },
      { path: "invites/workspace-owners", element: <InviteWorkspaceOwnerPage /> },
    ],
  },
])
