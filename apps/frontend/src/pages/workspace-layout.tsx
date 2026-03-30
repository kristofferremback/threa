import { useState, useEffect, useCallback, useContext, useMemo, type ReactNode } from "react"
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
  useSocket,
  useSocketReconnectCount,
  useWorkspaceService,
  useStreamService,
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
  useWorkspaceBootstrap,
  useKeyboardShortcuts,
  useMentionables,
  usePersistLastStream,
  useAppUpdate,
  useMessageQueue,
  useUnreadTabIndicator,
} from "@/hooks"
import { useAuth } from "@/auth"
import { useWorkspaceStreams } from "@/stores/workspace-store"
import { SyncEngine } from "@/sync/sync-engine"
import { QuickSwitcher, type QuickSwitcherMode } from "@/components/quick-switcher"
import { SettingsDialog } from "@/components/settings"
import { WorkspaceSettingsDialog } from "@/components/workspace-settings/workspace-settings-dialog"
import { StreamSettingsDialog } from "@/components/stream-settings/stream-settings-dialog"
import { CreateChannelDialog } from "@/components/create-channel"
import { TraceDialog } from "@/components/trace"
import { useQueryClient } from "@tanstack/react-query"
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

/**
 * Constructs a SyncEngine per workspace and wires it to socket lifecycle.
 * The engine owns bootstrap, reconnection, and all workspace-level socket
 * event handlers.
 */
function WorkspaceSyncHandler({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const socket = useSocket()
  const reconnectCount = useSocketReconnectCount()
  const queryClient = useQueryClient()
  const workspaceService = useWorkspaceService()
  const streamService = useStreamService()
  const syncStatusStore = useContext(SyncStatusContext)
  const { user } = useAuth()
  const { streamId: currentStreamId } = useParams<{ streamId: string }>()

  // Construct SyncEngine once per workspace (INV-13)
  const syncEngine = useMemo(
    () =>
      new SyncEngine({
        workspaceId,
        syncStatus: syncStatusStore!,
        queryClient,
        workspaceService,
        streamService,
      }),
    [workspaceId, syncStatusStore, queryClient, workspaceService, streamService]
  )

  // Keep syncEngine refs in sync with React state
  useEffect(() => {
    syncEngine.setCurrentStreamId(currentStreamId)
  }, [syncEngine, currentStreamId])

  useEffect(() => {
    syncEngine.setCurrentUser(user)
  }, [syncEngine, user])

  // Wire SyncEngine to socket connect/disconnect/reconnect
  useEffect(() => {
    if (!socket) {
      syncEngine.onDisconnect()
      return
    }
    void syncEngine.onConnect(socket)
    return () => syncEngine.onDisconnect()
  }, [socket, syncEngine, reconnectCount])

  // Cleanup on unmount
  useEffect(() => () => syncEngine.destroy(), [syncEngine])

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

  const { error: workspaceError } = useWorkspaceBootstrap(workspaceId ?? "")
  const { mentionables } = useMentionables()
  const streams = useWorkspaceStreams(workspaceId ?? "")

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
        <WorkspaceSyncHandler workspaceId={workspaceId}>
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
        </WorkspaceSyncHandler>
      </SocketProvider>
    </SyncStatusContext.Provider>
  )
}
