import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react"
import { Outlet, useParams, useNavigate, useSearchParams, useMatch } from "react-router-dom"
import { AppShell } from "@/components/layout/app-shell"
import { Sidebar } from "@/components/layout/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { MentionableMarkdownWrapper } from "@/components/ui/markdown-content"
import { WorkspaceEmojiProvider } from "@/components/workspace-emoji"
import {
  PanelProvider,
  QuickSwitcherProvider,
  PreferencesProvider,
  SettingsProvider,
  useSettings,
  CoordinatedLoadingProvider,
  CoordinatedLoadingGate,
  MainContentGate,
  SidebarProvider,
} from "@/contexts"
import { useSocketEvents, useWorkspaceBootstrap, useKeyboardShortcuts, useMentionables } from "@/hooks"
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
  const [searchParams] = useSearchParams()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switcherMode, setSwitcherMode] = useState<QuickSwitcherMode>("stream")

  // Extract streamId from nested route (if on /s/:streamId)
  const streamMatch = useMatch("/w/:workspaceId/s/:streamId")
  const streamId = streamMatch?.params.streamId

  // Collect all stream IDs: main stream + any open panels
  const streamIds = useMemo(() => {
    const panelIds = searchParams.getAll("panel")
    return [streamId, ...panelIds].filter((id): id is string => Boolean(id))
  }, [streamId, searchParams])

  const { error: workspaceError } = useWorkspaceBootstrap(workspaceId ?? "")
  const { mentionables } = useMentionables()

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
    <CoordinatedLoadingProvider workspaceId={workspaceId} streamIds={streamIds}>
      <MentionableMarkdownWrapper mentionables={mentionables}>
        <WorkspaceEmojiProvider workspaceId={workspaceId}>
          <PreferencesProvider workspaceId={workspaceId}>
            <SettingsProvider>
              <WorkspaceKeyboardHandler
                switcherOpen={switcherOpen}
                onOpenSwitcher={openSwitcher}
                onCloseSwitcher={closeSwitcher}
              >
                <QuickSwitcherProvider openSwitcher={openSwitcher}>
                  <PanelProvider>
                    <SidebarProvider>
                      <CoordinatedLoadingGate>
                        <AppShell sidebar={<Sidebar workspaceId={workspaceId} />}>
                          <MainContentGate>
                            <Outlet />
                          </MainContentGate>
                        </AppShell>
                      </CoordinatedLoadingGate>
                    </SidebarProvider>
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
        </WorkspaceEmojiProvider>
      </MentionableMarkdownWrapper>
    </CoordinatedLoadingProvider>
  )
}
