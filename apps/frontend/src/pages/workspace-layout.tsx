import { Outlet, useParams } from "react-router-dom"
import { AppShell } from "@/components/layout/app-shell"
import { Sidebar } from "@/components/layout/sidebar"

export function WorkspaceLayout() {
  const { workspaceId } = useParams<{ workspaceId: string }>()

  if (!workspaceId) {
    return null
  }

  return (
    <AppShell sidebar={<Sidebar workspaceId={workspaceId} />}>
      <Outlet />
    </AppShell>
  )
}
