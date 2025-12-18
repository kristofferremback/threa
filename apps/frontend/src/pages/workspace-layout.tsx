import { Outlet, useParams } from "react-router-dom"
import { AppShell } from "@/components/layout/app-shell"
import { Sidebar } from "@/components/layout/sidebar"
import { useSocketEvents } from "@/hooks"

export function WorkspaceLayout() {
  const { workspaceId } = useParams<{ workspaceId: string }>()

  // Subscribe to workspace-level socket events (stream create/update/archive)
  useSocketEvents(workspaceId ?? "")

  if (!workspaceId) {
    return null
  }

  return (
    <AppShell sidebar={<Sidebar workspaceId={workspaceId} />}>
      <Outlet />
    </AppShell>
  )
}
