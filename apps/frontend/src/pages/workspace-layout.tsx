import { useState, useEffect, useCallback, type ReactNode } from "react"
import { Outlet, useParams, useNavigate } from "react-router-dom"
import { AppShell } from "@/components/layout/app-shell"
import { Sidebar } from "@/components/layout/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { PanelProvider, QuickSwitcherProvider, PreferencesProvider, SettingsProvider, useSettings } from "@/contexts"
import { useSocketEvents, useWorkspaceBootstrap, useKeyboardShortcuts } from "@/hooks"
import { QuickSwitcher, type QuickSwitcherMode } from "@/components/quick-switcher"
import { SettingsDialog } from "@/components/settings"
import { ApiError } from "@/api/client"

interface WorkspaceKeyboardHandlerProps {
  switcherOpen: boolean
  onOpenSwitcher: (mode: QuickSwitcherMode) => void
  onCloseSwitcher: () => void
  children: ReactNode
}

function WorkspaceKeyboardHandler({
  switcherOpen,
  onOpenSwitcher,
  onCloseSwitcher,
  children,
}: WorkspaceKeyboardHandlerProps) {
  const { isOpen: settingsOpen, openSettings, closeSettings } = useSettings()

  useKeyboardShortcuts({
    openQuickSwitcher: () => onOpenSwitcher("stream"),
    openSearch: () => onOpenSwitcher("search"),
    openCommands: () => onOpenSwitcher("command"),
    openSettings: () => openSettings(),
    closeModal: () => {
      if (settingsOpen) {
        closeSettings()
      } else if (switcherOpen) {
        onCloseSwitcher()
      }
    },
  })

  return <>{children}</>
}

export function WorkspaceLayout() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switcherMode, setSwitcherMode] = useState<QuickSwitcherMode>("stream")

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

  const closeSwitcher = useCallback(() => {
    setSwitcherOpen(false)
  }, [])

  if (!workspaceId) {
    return null
  }

  return (
    <PreferencesProvider workspaceId={workspaceId}>
      <SettingsProvider>
        <WorkspaceKeyboardHandler
          switcherOpen={switcherOpen}
          onOpenSwitcher={openSwitcher}
          onCloseSwitcher={closeSwitcher}
        >
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
              <SettingsDialog />
              <Toaster />
            </PanelProvider>
          </QuickSwitcherProvider>
        </WorkspaceKeyboardHandler>
      </SettingsProvider>
    </PreferencesProvider>
  )
}
