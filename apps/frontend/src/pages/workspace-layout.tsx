import { useState, useEffect, useCallback } from "react"
import { Outlet, useParams } from "react-router-dom"
import { AppShell } from "@/components/layout/app-shell"
import { Sidebar } from "@/components/layout/sidebar"
import { PanelProvider, QuickSwitcherProvider } from "@/contexts"
import { useSocketEvents } from "@/hooks"
import { QuickSwitcher, type QuickSwitcherMode } from "@/components/quick-switcher"

export function WorkspaceLayout() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switcherMode, setSwitcherMode] = useState<QuickSwitcherMode>("stream")

  useSocketEvents(workspaceId ?? "")

  const openSwitcher = useCallback((mode: QuickSwitcherMode) => {
    setSwitcherMode(mode)
    setSwitcherOpen(true)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey

      // Ctrl+[ as vim-style Escape alternative for closing quick switcher
      if (e.ctrlKey && e.key === "[" && switcherOpen) {
        e.preventDefault()
        setSwitcherOpen(false)
        return
      }

      // Cmd+Shift+K → Command mode
      if (isMod && e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault()
        openSwitcher("command")
        return
      }

      // Cmd+K → Stream mode (default)
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault()
        openSwitcher("stream")
        return
      }

      // Cmd+Shift+F → Search mode (leave Cmd+F for browser find)
      if (isMod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault()
        openSwitcher("search")
        return
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [openSwitcher, switcherOpen])

  if (!workspaceId) {
    return null
  }

  return (
    <QuickSwitcherProvider openSwitcher={openSwitcher}>
      <PanelProvider>
        <AppShell sidebar={<Sidebar workspaceId={workspaceId} />}>
          <Outlet />
        </AppShell>
        <QuickSwitcher
          workspaceId={workspaceId}
          open={switcherOpen}
          onOpenChange={setSwitcherOpen}
          initialMode={switcherMode}
        />
      </PanelProvider>
    </QuickSwitcherProvider>
  )
}
