import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react"
import { Outlet, useParams, useNavigate, useSearchParams, useMatch } from "react-router-dom"
import { AppShell } from "@/components/layout/app-shell"
import { Sidebar } from "@/components/layout/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { MentionableMarkdownWrapper, type MentionableMarkdownWrapperProps } from "@/components/ui/markdown-content"
import type { MentionType } from "@/lib/markdown/mention-context"
import { UserProfileProvider, useUserProfile } from "@/components/user-profile"
import { WorkspaceEmojiProvider } from "@/components/workspace-emoji"
import { ChannelLinkProvider } from "@/lib/markdown/channel-link-context"
import {
  SocketProvider,
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
  usePersistLastStream,
  useAppUpdate,
  useMessageQueue,
  useUnreadTabIndicator,
} from "@/hooks"
import { QuickSwitcher, type QuickSwitcherMode } from "@/components/quick-switcher"
import { SettingsDialog } from "@/components/settings"
import { WorkspaceSettingsDialog } from "@/components/workspace-settings/workspace-settings-dialog"
import { StreamSettingsDialog } from "@/components/stream-settings/stream-settings-dialog"
import { CreateChannelDialog } from "@/components/create-channel"
import { TraceDialog } from "@/components/trace"
import { ApiError } from "@/api/client"
import { SyncStatusStore, SyncStatusContext } from "@/sync/sync-status"

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

interface WorkspaceSocketHandlerProps {
  workspaceId: string
  streamIds: string[]
  children: ReactNode
}

function WorkspaceSocketHandler({ workspaceId, streamIds, children }: WorkspaceSocketHandlerProps) {
  useSocketEvents(workspaceId)
  useReconnectBootstrap(workspaceId, streamIds)
  return <>{children}</>
}

function MessageQueueHandler() {
  useMessageQueue()
  return null
}

function UnreadTabIndicator({ workspaceId }: { workspaceId: string }) {
  useUnreadTabIndicator(workspaceId)
  return null
}

function AppUpdateChecker() {
  useAppUpdate()
  return null
}

function TraceDialogContainer() {
  const { isOpen } = useTrace()

  if (!isOpen) {
    return null
  }

  return <TraceDialog />
}

/** Bridges UserProfileProvider with MentionableMarkdownWrapper (INV-18: standalone component). */
function MentionableWrapper({ children, mentionables }: Omit<MentionableMarkdownWrapperProps, "onMentionClick">) {
  const { openUserProfile } = useUserProfile()

  const handleMentionClick = useCallback(
    (slug: string, type: MentionType) => {
      if (type !== "user" && type !== "me") return
      const mentionable = mentionables.find((m) => m.slug === slug)
      if (mentionable) openUserProfile(mentionable.id)
    },
    [mentionables, openUserProfile]
  )

  return (
    <MentionableMarkdownWrapper mentionables={mentionables} onMentionClick={handleMentionClick}>
      {children}
    </MentionableMarkdownWrapper>
  )
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

  usePersistLastStream(workspaceId, streamId)

  useEffect(() => {
    if (
      workspaceError &&
      ApiError.isApiError(workspaceError) &&
      (workspaceError.status === 404 || workspaceError.status === 403)
    ) {
      navigate("/workspaces", { replace: true })
    }
  }, [workspaceError, navigate])

  const openSwitcher = useCallback((mode: QuickSwitcherMode) => {
    setSwitcherMode(mode)
    setSwitcherOpen(true)
  }, [])

  const closeSwitcher = useCallback(() => {
    setSwitcherOpen(false)
  }, [])

  // Single SyncStatusStore instance per workspace — tracks sync state for all resources.
  const syncStatusStore = useMemo(() => new SyncStatusStore(), [workspaceId])

  if (!workspaceId) {
    return null
  }

  return (
    <SyncStatusContext.Provider value={syncStatusStore}>
      <SocketProvider workspaceId={workspaceId}>
        <WorkspaceSocketHandler workspaceId={workspaceId} streamIds={streamIds}>
          <UnreadTabIndicator workspaceId={workspaceId} />
          <AppUpdateChecker />
          <MessageQueueHandler />
          <CoordinatedLoadingProvider workspaceId={workspaceId} streamIds={streamIds}>
            <ChannelLinkProvider workspaceId={workspaceId} streams={streams}>
              <UserProfileProvider>
                <MentionableWrapper mentionables={mentionables}>
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
                                <CreateChannelDialog workspaceId={workspaceId} />
                                <TraceDialogContainer />
                                <Toaster />
                              </TraceProvider>
                            </PanelProvider>
                          </QuickSwitcherProvider>
                        </WorkspaceKeyboardHandler>
                      </SettingsProvider>
                    </PreferencesProvider>
                  </WorkspaceEmojiProvider>
                </MentionableWrapper>
              </UserProfileProvider>
            </ChannelLinkProvider>
          </CoordinatedLoadingProvider>
        </WorkspaceSocketHandler>
      </SocketProvider>
    </SyncStatusContext.Provider>
  )
}
