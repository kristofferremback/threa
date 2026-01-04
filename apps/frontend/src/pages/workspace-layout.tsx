import { useState, useEffect, useCallback } from "react"
import { Outlet, useParams, useNavigate } from "react-router-dom"
import { AppShell } from "@/components/layout/app-shell"
import { Sidebar } from "@/components/layout/sidebar"
import { PanelProvider, QuickSwitcherProvider, DraftsModalProvider } from "@/contexts"
import { useSocketEvents, useWorkspaceBootstrap } from "@/hooks"
import { QuickSwitcher, type QuickSwitcherMode } from "@/components/quick-switcher"
import { DraftsModal } from "@/components/drafts-modal"
import { ApiError } from "@/api/client"

export function WorkspaceLayout() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switcherMode, setSwitcherMode] = useState<QuickSwitcherMode>("stream")
  const [draftsModalOpen, setDraftsModalOpen] = useState(false)

  const { error: workspaceError } = useWorkspaceBootstrap(workspaceId ?? "")

  useEffect(() => {
    if (
      workspaceError &&
      ApiError.isApiError(workspaceError) &&
      (workspaceError.status === 404 || workspaceError.status === 403)
    ) {
      navigate("/workspaces", { replace: true })
    }
  }, [workspaceError, navigate])

  useSocketEvents(workspaceId ?? "")

  const openSwitcher = useCallback((mode: QuickSwitcherMode) => {
    setSwitcherMode(mode)
    setSwitcherOpen(true)
  }, [])

  const openDraftsModal = useCallback(() => {
    setDraftsModalOpen(true)
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
    <DraftsModalProvider openDraftsModal={openDraftsModal}>
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
          <DraftsModal workspaceId={workspaceId} open={draftsModalOpen} onOpenChange={setDraftsModalOpen} />
        </PanelProvider>
      </QuickSwitcherProvider>
    </DraftsModalProvider>
  )
}
