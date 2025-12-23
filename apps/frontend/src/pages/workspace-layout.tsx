import { useState, useEffect } from "react"
import { Outlet, useParams } from "react-router-dom"
import { AppShell } from "@/components/layout/app-shell"
import { Sidebar } from "@/components/layout/sidebar"
import { PanelProvider } from "@/contexts"
import { useSocketEvents } from "@/hooks"
import { SearchDialog } from "@/components/search"

export function WorkspaceLayout() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [searchOpen, setSearchOpen] = useState(false)

  // Subscribe to workspace-level socket events (stream create/update/archive)
  useSocketEvents(workspaceId ?? "")

  // Keyboard shortcut to open search (Cmd+K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setSearchOpen(true)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  if (!workspaceId) {
    return null
  }

  return (
    <PanelProvider>
      <AppShell sidebar={<Sidebar workspaceId={workspaceId} />}>
        <Outlet />
      </AppShell>
      <SearchDialog workspaceId={workspaceId} open={searchOpen} onOpenChange={setSearchOpen} />
    </PanelProvider>
  )
}
