import { useState, useEffect, useCallback } from "react"
import { useAuth } from "../../auth"
import { useBootstrap, usePaneManager, useWorkspaceSocket } from "../../hooks"
import { ChatInterface } from "../ChatInterface"
import { Sidebar } from "./Sidebar"
import { PaneSystem } from "./PaneSystem"
import { CreateWorkspaceModal } from "./CreateWorkspaceModal"
import { CreateChannelModal } from "./CreateChannelModal"
import { ChannelSettingsModal } from "./ChannelSettingsModal"
import { CommandPalette } from "./CommandPalette"
import { InviteModal } from "../InviteModal"
import { InboxView } from "./InboxView"
import { LoadingScreen, LoginScreen, NoWorkspaceScreen, ErrorScreen } from "./screens"
import type { Tab, Channel } from "../../types"

export function LayoutSystem() {
  const { isAuthenticated, state, logout, user } = useAuth()
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [channelToEdit, setChannelToEdit] = useState<Channel | null>(null)
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0)

  // Bootstrap data
  const {
    data: bootstrapData,
    isLoading: bootstrapLoading,
    error: bootstrapError,
    noWorkspace,
    refetch: refetchBootstrap,
    addChannel,
    updateChannel,
    removeChannel,
    incrementUnreadCount,
    resetUnreadCount,
  } = useBootstrap({
    enabled: isAuthenticated && state === "loaded",
  })

  // Pane management
  const {
    panes,
    focusedPaneId,
    activeChannelSlug,
    setFocusedPane,
    setActiveTab,
    closeTab,
    selectChannel,
    openItem,
    initializeFromUrl,
  } = usePaneManager({
    channels: bootstrapData?.channels || [],
  })

  // Initialize panes from URL when bootstrap data is ready
  useEffect(() => {
    if (bootstrapData) {
      initializeFromUrl()
    }
  }, [bootstrapData, initializeFromUrl])

  // Check if activity view is active
  const isActivityActive = panes.some((pane) => {
    const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId)
    return activeTab?.type === "activity"
  })

  // Handle being removed from a channel
  const handleChannelRemoved = useCallback(
    (channelId: string) => {
      removeChannel(channelId)

      // If we're currently viewing this channel, navigate away
      if (bootstrapData && activeChannelSlug) {
        const removedChannel = bootstrapData.channels.find((c) => c.id === channelId || c.slug === channelId)
        if (removedChannel && (removedChannel.slug === activeChannelSlug || removedChannel.id === activeChannelSlug)) {
          // Find another channel to navigate to
          const remainingChannels = bootstrapData.channels.filter((c) => c.id !== channelId && c.is_member)
          if (remainingChannels.length > 0) {
            selectChannel(remainingChannels[0])
          } else {
            // No channels left - clear the pane
            // For now, just leave it - the user will see an empty state
          }
        }
      }
    },
    [removeChannel, bootstrapData, activeChannelSlug, selectChannel],
  )

  // Workspace-level WebSocket for real-time updates
  const { socket } = useWorkspaceSocket({
    enabled: isAuthenticated && !!bootstrapData,
    workspaceId: bootstrapData?.workspace.id,
    activeChannelSlug: activeChannelSlug || undefined,
    currentUserId: user?.id,
    onChannelAdded: addChannel,
    onChannelRemoved: handleChannelRemoved,
    onUnreadCountUpdate: incrementUnreadCount,
    onNewNotification: () => setInboxUnreadCount((prev) => prev + 1),
  })

  // Fetch inbox unread count
  useEffect(() => {
    if (!bootstrapData?.workspace.id) return

    const fetchUnreadCount = async () => {
      try {
        const res = await fetch(`/api/workspace/${bootstrapData.workspace.id}/notifications/count`, {
          credentials: "include",
        })
        if (res.ok) {
          const data = await res.json()
          setInboxUnreadCount(data.count)
        }
      } catch (err) {
        console.error("Failed to fetch notification count:", err)
      }
    }

    fetchUnreadCount()
    // Refresh every 30 seconds
    const interval = setInterval(fetchUnreadCount, 30000)
    return () => clearInterval(interval)
  }, [bootstrapData?.workspace.id])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+P for command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault()
        setShowCommandPalette((prev) => !prev)
      }
      // Cmd/Ctrl+Shift+I for inbox
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "i") {
        e.preventDefault()
        setShowInbox((prev) => !prev)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Wrapper for selectChannel that also resets unread count
  const handleSelectChannel = useCallback(
    (channel: Channel) => {
      selectChannel(channel)
      resetUnreadCount(channel.id)
    },
    [selectChannel, resetUnreadCount],
  )

  // Handle channel selection from command palette
  const handleCommandPaletteSelect = useCallback(
    async (channel: Channel) => {
      // If not a member, join the channel first
      if (!channel.is_member && bootstrapData) {
        try {
          const res = await fetch(`/api/workspace/${bootstrapData.workspace.id}/channels/${channel.id}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ userId: user?.id }),
          })

          if (res.ok) {
            // Update the channel in bootstrap data to reflect membership
            updateChannel({ ...channel, is_member: true })
          }
        } catch (error) {
          console.error("Failed to join channel:", error)
        }
      }
      handleSelectChannel(channel)
    },
    [handleSelectChannel, bootstrapData, user?.id, updateChannel],
  )

  // Helper to get channel from slug or ID
  const getChannelFromSlug = (channelSlug?: string) => {
    if (!channelSlug || !bootstrapData) return undefined
    return bootstrapData.channels.find((c) => c.slug === channelSlug || c.id === channelSlug)
  }

  // Render content for a tab
  const renderTabContent = (tab: Tab, paneId: string) => {
    if (!bootstrapData) return null

    // Handle activity tab
    if (tab.type === "activity") {
      return (
        <InboxView
          workspaceId={bootstrapData.workspace.id}
          socket={socket}
          onUnreadCountChange={setInboxUnreadCount}
          onNavigateToChannel={(channelSlug, mode = "replace", highlightMessageId) => {
            const channel = bootstrapData.channels.find((c) => c.slug === channelSlug)
            if (channel) {
              openItem(
                {
                  title: `#${channel.name.replace("#", "")}`,
                  type: "channel",
                  data: { channelSlug, highlightMessageId },
                },
                mode,
                paneId,
              )
            }
          }}
          onNavigateToThread={(threadId, channelId, mode = "replace", highlightMessageId) => {
            const channel = bootstrapData.channels.find((c) => c.id === channelId || c.slug === channelId)
            openItem(
              {
                title: "Thread",
                type: "thread",
                data: { threadId, channelSlug: channel?.slug || channelId, highlightMessageId },
              },
              mode,
              paneId,
            )
          }}
        />
      )
    }

    // Look up actual channel from slug stored in tab data
    const channel = getChannelFromSlug(tab.data?.channelSlug)
    // Use actual channel ID for socket connections, fall back to slug for backwards compatibility
    const actualChannelId = channel?.id || tab.data?.channelSlug
    const channelName = channel?.name.replace("#", "")

    return (
      <ChatInterface
        workspaceId={bootstrapData.workspace.id}
        channelId={actualChannelId}
        channelName={channelName}
        threadId={tab.data?.threadId}
        highlightMessageId={tab.data?.highlightMessageId}
        title={tab.title}
        users={bootstrapData.users}
        channels={bootstrapData.channels.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))}
        onOpenThread={(msgId, msgChannelId, mode) => {
          // Pass the pane ID where the click originated so the thread opens relative to that pane
          openItem(
            {
              title: "Thread",
              type: "thread",
              data: { threadId: msgId, channelSlug: msgChannelId },
            },
            mode,
            paneId,
          )
        }}
        onGoToChannel={(channelSlug, mode) => {
          const channel = bootstrapData.channels.find((c) => c.slug === channelSlug || c.id === channelSlug)
          const slug = channel?.slug || channelSlug
          const name = channel?.name.replace("#", "") || slug

          // Pass the pane ID where the click originated
          openItem(
            {
              title: `#${name}`,
              type: "channel",
              data: { channelSlug: slug },
            },
            mode,
            paneId,
          )
        }}
      />
    )
  }

  // Loading states
  if (state === "new" || state === "loading") {
    return <LoadingScreen />
  }

  if (!isAuthenticated) {
    return <LoginScreen />
  }

  if (bootstrapLoading) {
    return <LoadingScreen />
  }

  if (noWorkspace) {
    return (
      <>
        <NoWorkspaceScreen onCreateWorkspace={() => setShowCreateWorkspace(true)} />
        {showCreateWorkspace && (
          <CreateWorkspaceModal
            open={showCreateWorkspace}
            onClose={() => setShowCreateWorkspace(false)}
            onCreated={() => {
              setShowCreateWorkspace(false)
              window.location.reload()
            }}
          />
        )}
      </>
    )
  }

  if (bootstrapError || !bootstrapData) {
    return (
      <ErrorScreen message={bootstrapError || "Failed to load workspace"} onRetry={() => window.location.reload()} />
    )
  }

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "var(--bg-primary)" }}>
      <Sidebar
        workspace={bootstrapData.workspace}
        channels={bootstrapData.channels}
        activeChannelSlug={isActivityActive ? null : activeChannelSlug}
        onSelectChannel={handleSelectChannel}
        onCreateChannel={() => setShowCreateChannel(true)}
        onChannelSettings={(channel) => setChannelToEdit(channel)}
        onInvitePeople={() => setShowInviteModal(true)}
        onLogout={logout}
        onOpenCommandPalette={() => setShowCommandPalette(true)}
        onOpenInbox={() => openItem({ title: "Activity", type: "activity", data: {} }, "replace")}
        isInboxActive={isActivityActive}
        inboxUnreadCount={inboxUnreadCount}
      />

      <CreateChannelModal
        open={showCreateChannel}
        workspaceId={bootstrapData.workspace.id}
        onClose={() => setShowCreateChannel(false)}
        onCreated={(channel: Channel) => {
          setShowCreateChannel(false)
          addChannel(channel)
          handleSelectChannel(channel)
        }}
      />

      <ChannelSettingsModal
        open={channelToEdit !== null}
        channel={channelToEdit}
        workspaceId={bootstrapData.workspace.id}
        currentUserId={user?.id}
        isWorkspaceOwner={bootstrapData.user_role === "owner"}
        onClose={() => setChannelToEdit(null)}
        onUpdated={(channel) => {
          updateChannel(channel)
          setChannelToEdit(null)
        }}
        onArchived={(channelId) => {
          removeChannel(channelId)
          setChannelToEdit(null)
          // If we're viewing the archived channel, navigate away
          if (activeChannelSlug === channelToEdit?.slug) {
            const firstChannel = bootstrapData.channels.find((c) => c.id !== channelId)
            if (firstChannel) handleSelectChannel(firstChannel)
          }
        }}
      />

      <InviteModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        workspaceId={bootstrapData.workspace.id}
        workspaceName={bootstrapData.workspace.name}
      />

      <div className="flex-1 min-w-0">
        <PaneSystem
          panes={panes}
          focusedPaneId={focusedPaneId}
          onFocusPane={setFocusedPane}
          onSetActiveTab={setActiveTab}
          onCloseTab={closeTab}
          renderContent={renderTabContent}
        />
      </div>

      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        channels={bootstrapData.channels}
        onSelectChannel={handleCommandPaletteSelect}
      />
    </div>
  )
}
