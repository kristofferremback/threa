import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react"
import { Outlet, useParams, useNavigate, useSearchParams, useMatch } from "react-router-dom"
import { AppShell } from "@/components/layout/app-shell"
import { Sidebar } from "@/components/layout/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { MentionableMarkdownWrapper } from "@/components/ui/markdown-content"
import { WorkspaceEmojiProvider } from "@/components/workspace-emoji"
import { ChannelLinkProvider } from "@/lib/markdown/channel-link-context"
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
  TraceProvider,
  useTrace,
} from "@/contexts"
import {
  useSocketEvents,
  useWorkspaceBootstrap,
  useKeyboardShortcuts,
  useMentionables,
  useReconnectBootstrap,
} from "@/hooks"
import { QuickSwitcher, type QuickSwitcherMode } from "@/components/quick-switcher"
import { SettingsDialog } from "@/components/settings"
import { WorkspaceSettingsDialog } from "@/components/workspace-settings/workspace-settings-dialog"
import { StreamSettingsDialog } from "@/components/stream-settings/stream-settings-dialog"
import { TraceDialog } from "@/components/trace"
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

function TraceDialogContainer() {
  const { isOpen } = useTrace()

  if (!isOpen) {
    return null
  }

  return <TraceDialog />
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

  const { data: bootstrap, error: workspaceError } = useWorkspaceBootstrap(workspaceId ?? "")
  const { mentionables } = useMentionables()
  const streams = useMemo(() => bootstrap?.streams ?? [], [bootstrap])

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

  // Handle reconnection: re-bootstrap workspace and streams when socket reconnects
  useReconnectBootstrap(workspaceId ?? "", streamIds)

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
      <ChannelLinkProvider workspaceId={workspaceId} streams={streams}>
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
                      <TraceProvider>
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
                        <WorkspaceSettingsDialog workspaceId={workspaceId} />
                        <StreamSettingsDialog workspaceId={workspaceId} />
                        <TraceDialogContainer />
                        <Toaster />
                      </TraceProvider>
                    </PanelProvider>
                  </QuickSwitcherProvider>
                </WorkspaceKeyboardHandler>
              </SettingsProvider>
            </PreferencesProvider>
          </WorkspaceEmojiProvider>
        </MentionableMarkdownWrapper>
      </ChannelLinkProvider>
    </CoordinatedLoadingProvider>
  )
}
