import { useState, useEffect, useCallback } from "react"
import { useAuth } from "../../auth"
import { useBootstrap, usePaneManager } from "../../hooks"
import { ChatInterface } from "../ChatInterface"
import { Sidebar } from "./Sidebar"
import { PaneSystem } from "./PaneSystem"
import { CreateWorkspaceModal } from "./CreateWorkspaceModal"
import { CreateChannelModal } from "./CreateChannelModal"
import { ChannelSettingsModal } from "./ChannelSettingsModal"
import { CommandPalette } from "./CommandPalette"
import { InviteModal } from "../InviteModal"
import { LoadingScreen, LoginScreen, NoWorkspaceScreen, ErrorScreen } from "./screens"
import type { Tab, Channel } from "../../types"

export function LayoutSystem() {
  const { isAuthenticated, state, logout, user } = useAuth()
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [channelToEdit, setChannelToEdit] = useState<Channel | null>(null)

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

  // Global keyboard shortcut for command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setShowCommandPalette((prev) => !prev)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

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
      selectChannel(channel)
    },
    [selectChannel, bootstrapData, user?.id, updateChannel],
  )

  // Helper to get channel name from slug
  const getChannelName = (channelSlug?: string) => {
    if (!channelSlug || !bootstrapData) return undefined
    const channel = bootstrapData.channels.find((c) => c.slug === channelSlug || c.id === channelSlug)
    return channel?.name.replace("#", "")
  }

  // Render content for a tab
  const renderTabContent = (tab: Tab, paneId: string) => {
    if (!bootstrapData) return null

    const channelName = getChannelName(tab.data?.channelId)

    return (
      <ChatInterface
        workspaceId={bootstrapData.workspace.id}
        channelId={tab.data?.channelId}
        channelName={channelName}
        threadId={tab.data?.threadId}
        title={tab.title}
        onOpenThread={(msgId, msgChannelId, mode) => {
          // Pass the pane ID where the click originated so the thread opens relative to that pane
          openItem(
            {
              title: "Thread",
              type: "thread",
              data: { threadId: msgId, channelId: msgChannelId },
            },
            mode,
            paneId,
          )
        }}
        onGoToChannel={(channelId, mode) => {
          const channel = bootstrapData.channels.find((c) => c.slug === channelId || c.id === channelId)
          const channelSlug = channel?.slug || channelId
          const name = channel?.name.replace("#", "") || channelSlug

          // Pass the pane ID where the click originated
          openItem(
            {
              title: `#${name}`,
              type: "channel",
              data: { channelId: channelSlug },
            },
            mode,
            paneId,
          )
        }}
        onChannelRemoved={(removedChannelId) => {
          // Remove the channel from the sidebar
          removeChannel(removedChannelId)
          // Navigate away if we're viewing the removed channel
          if (tab.data?.channelId === removedChannelId) {
            const firstChannel = bootstrapData.channels.find((c) => c.id !== removedChannelId)
            if (firstChannel) selectChannel(firstChannel)
          }
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
        activeChannelSlug={activeChannelSlug}
        onSelectChannel={selectChannel}
        onCreateChannel={() => setShowCreateChannel(true)}
        onChannelSettings={(channel) => setChannelToEdit(channel)}
        onInvitePeople={() => setShowInviteModal(true)}
        onLogout={logout}
        onOpenCommandPalette={() => setShowCommandPalette(true)}
      />

      <CreateChannelModal
        open={showCreateChannel}
        workspaceId={bootstrapData.workspace.id}
        onClose={() => setShowCreateChannel(false)}
        onCreated={(channel: Channel) => {
          setShowCreateChannel(false)
          addChannel(channel)
          selectChannel(channel)
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
            if (firstChannel) selectChannel(firstChannel)
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
