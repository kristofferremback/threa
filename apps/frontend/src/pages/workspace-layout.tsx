import { useState, useEffect, useCallback, useContext, useMemo, useRef, type ReactNode } from "react"
import { Outlet, useParams, useNavigate, useSearchParams, useMatch, Navigate } from "react-router-dom"
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
  useMessageService,
  PanelProvider,
  QuickSwitcherProvider,
  PreferencesProvider,
  SettingsProvider,
  useSettings,
  CoordinatedLoadingProvider,
  CoordinatedLoadingGate,
  MainContentGate,
  SidebarProvider,
  useSidebar,
  TraceProvider,
  useTrace,
} from "@/contexts"
import {
  useKeyboardShortcuts,
  useMentionables,
  usePersistLastStream,
  useAppUpdate,
  useMessageQueue,
  useUnreadTabIndicator,
} from "@/hooks"
import { useAuth } from "@/auth"
import { useWorkspaceStreams } from "@/stores/workspace-store"
import { SyncEngine, SyncEngineContext } from "@/sync/sync-engine"
import { messagesApi } from "@/api"
import { useSyncStatus } from "@/sync/sync-status"
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
 * Registers sidebar-related keyboard shortcuts. Must be rendered inside
 * SidebarProvider so it can access the sidebar context.
 */
function SidebarKeyboardHandler() {
  const { togglePinned } = useSidebar()

  useKeyboardShortcuts({
    toggleSidebar: togglePinned,
  })

  return null
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
  const messageService = useMessageService()
  const syncStatusStore = useContext(SyncStatusContext)
  const { user } = useAuth()
  const { streamId: currentStreamId } = useParams<{ streamId: string }>()

  // Construct SyncEngine once per workspace. Use ref to survive StrictMode
  // double-render — useMemo + destroy effect breaks because the cleanup
  // destroys the engine before the socket connect effect fires.
  const syncEngineRef = useRef<SyncEngine | null>(null)
  if (
    !syncEngineRef.current ||
    syncEngineRef.current.workspaceId !== workspaceId ||
    syncEngineRef.current.isDestroyed
  ) {
    syncEngineRef.current?.destroy()
    syncEngineRef.current = new SyncEngine({
      workspaceId,
      syncStatus: syncStatusStore!,
      queryClient,
      workspaceService,
      streamService,
      messageService,
      reactionService: {
        add: (wid: string, mid: string, emoji: string) => messagesApi.addReaction(wid, mid, emoji),
        remove: (wid: string, mid: string, emoji: string) => messagesApi.removeReaction(wid, mid, emoji),
      },
    })
  }
  const syncEngine = syncEngineRef.current

  // Keep syncEngine refs in sync with React state
  useEffect(() => {
    syncEngine.setCurrentStreamId(currentStreamId)
  }, [syncEngine, currentStreamId])

  useEffect(() => {
    syncEngine.setCurrentUser(user)
  }, [syncEngine, user])

  // Wire SyncEngine to socket connect/disconnect/reconnect
  useEffect(() => {
    console.log("[WorkspaceSyncHandler] effect fired", { hasSocket: !!socket, reconnectCount })
    if (!socket) {
      syncEngine.onDisconnect()
      return
    }
    console.log("[WorkspaceSyncHandler] calling syncEngine.onConnect")
    void syncEngine.onConnect(socket)
    return () => syncEngine.onDisconnect()
  }, [socket, syncEngine, reconnectCount])

  // No destroy effect — StrictMode's effect cleanup cycle would destroy the
  // engine before the socket connect effect re-runs. The engine is destroyed
  // on workspace change (line above) and on page unload (browser handles it).

  // Redirect on terminal workspace errors (404/403)
  const navigate = useNavigate()
  const workspaceSyncStatus = useSyncStatus(`workspace:${workspaceId}`)
  useEffect(() => {
    if (workspaceSyncStatus !== "error") return
    const err = syncEngine.lastWorkspaceError
    if (err && ApiError.isApiError(err) && (err.status === 404 || err.status === 403)) {
      navigate("/workspaces", { replace: true })
    }
  }, [workspaceSyncStatus, syncEngine, navigate])

  return <SyncEngineContext.Provider value={syncEngine}>{children}</SyncEngineContext.Provider>
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
  const [searchParams] = useSearchParams()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switcherMode, setSwitcherMode] = useState<QuickSwitcherMode>("stream")
  const { user, loading: authLoading } = useAuth()

  // Extract streamId from nested route (if on /s/:streamId)
  const streamMatch = useMatch("/w/:workspaceId/s/:streamId")
  const streamId = streamMatch?.params.streamId

  // Collect all stream IDs: main stream + any open panels
  const streamIds = useMemo(() => {
    const panelIds = searchParams.getAll("panel")
    return [streamId, ...panelIds].filter((id): id is string => Boolean(id))
  }, [streamId, searchParams])

  const { mentionables } = useMentionables()
  const streams = useWorkspaceStreams(workspaceId ?? "")

  usePersistLastStream(workspaceId, streamId)

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

  if (authLoading) {
    return null
  }

  if (!user) {
    return <Navigate to="/login" replace />
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
                                  <SidebarKeyboardHandler />
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
