import { useState, useEffect, useCallback } from "react"
import { useAuth } from "../../auth"
import { useBootstrap, usePaneManager, useWorkspaceSocket } from "../../hooks"
import { StreamInterface } from "../StreamInterface"
import { Sidebar } from "./Sidebar"
import { PaneSystem } from "./PaneSystem"
import { CreateWorkspaceModal } from "./CreateWorkspaceModal"
import { CreateChannelModal } from "./CreateChannelModal"
import { ChannelSettingsModal } from "./ChannelSettingsModal"
import { CommandPalette } from "./CommandPalette"
import { BrowseChannelsModal } from "./BrowseChannelsModal"
import { NewDMModal } from "./NewDMModal"
import { InviteModal } from "../InviteModal"
import { InboxView } from "./InboxView"
import { LoadingScreen, LoginScreen, NoWorkspaceScreen, ErrorScreen } from "./screens"
import type { Tab, Stream, OpenMode } from "../../types"

export function LayoutSystem() {
  const { isAuthenticated, state, logout, user } = useAuth()
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showNewDM, setShowNewDM] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showBrowseChannels, setShowBrowseChannels] = useState(false)
  const [streamToEdit, setStreamToEdit] = useState<Stream | null>(null)
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0)

  // Bootstrap data
  const {
    data: bootstrapData,
    isLoading: bootstrapLoading,
    error: bootstrapError,
    noWorkspace,
    refetch: refetchBootstrap,
    addStream,
    updateStream,
    removeStream,
    incrementUnreadCount,
    resetUnreadCount,
  } = useBootstrap({
    enabled: isAuthenticated && state === "loaded",
  })

  // Pane management
  const {
    panes,
    focusedPaneId,
    activeStreamSlug,
    setFocusedPane,
    setActiveTab,
    closeTab,
    selectStream,
    openItem,
    updateTabData,
    initializeFromUrl,
  } = usePaneManager({
    streams: bootstrapData?.streams || [],
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

  // Handle being removed from a stream
  const handleStreamRemoved = useCallback(
    (streamId: string) => {
      removeStream(streamId)

      // If we're currently viewing this stream, navigate away
      if (bootstrapData && activeStreamSlug) {
        const removedStream = bootstrapData.streams.find((s) => s.id === streamId || s.slug === streamId)
        if (removedStream && (removedStream.slug === activeStreamSlug || removedStream.id === activeStreamSlug)) {
          // Find another channel to navigate to
          const remainingStreams = bootstrapData.streams.filter(
            (s) => s.id !== streamId && s.isMember && s.streamType === "channel",
          )
          const firstStream = remainingStreams[0]
          if (firstStream) {
            selectStream(firstStream)
          }
        }
      }
    },
    [removeStream, bootstrapData, activeStreamSlug, selectStream],
  )

  // Workspace-level WebSocket for real-time updates
  const { socket } = useWorkspaceSocket({
    enabled: isAuthenticated && !!bootstrapData,
    workspaceId: bootstrapData?.workspace.id,
    activeStreamSlug: activeStreamSlug || undefined,
    currentUserId: user?.id,
    onStreamAdded: addStream,
    onStreamRemoved: handleStreamRemoved,
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
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Wrapper for selectStream that also resets unread count and supports open modes
  const handleSelectStream = useCallback(
    (stream: Stream, mode: OpenMode = "replace") => {
      const streamTab = {
        title: `#${(stream.name || "").replace("#", "")}`,
        type: "stream" as const,
        data: { streamSlug: stream.slug || undefined, streamId: stream.id },
      }

      if (mode === "replace") {
        selectStream(stream)
      } else {
        openItem(streamTab, mode)
      }
      resetUnreadCount(stream.id)
    },
    [selectStream, openItem, resetUnreadCount],
  )

  // Handle stream selection from command palette
  const handleCommandPaletteSelect = useCallback(
    async (stream: Stream, mode: OpenMode = "replace") => {
      // If not a member, join the stream first
      if (!stream.isMember && bootstrapData) {
        try {
          const res = await fetch(`/api/workspace/${bootstrapData.workspace.id}/streams/${stream.id}/join`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
          })

          if (res.ok) {
            const data = await res.json()
            const joinedStream: Stream = data.stream
              ? {
                  ...data.stream,
                  isMember: true,
                  pinnedAt: null,
                }
              : { ...stream, isMember: true, pinnedAt: null }

            // Check if stream already exists in list
            const existingStream = bootstrapData.streams.find((s) => s.id === stream.id)
            if (existingStream) {
              updateStream(joinedStream)
            } else {
              addStream(joinedStream)
            }

            handleSelectStream(joinedStream, mode)
            return
          }
        } catch (error) {
          console.error("Failed to join stream:", error)
        }
      }
      handleSelectStream(stream, mode)
    },
    [handleSelectStream, bootstrapData, updateStream, addStream],
  )

  // Handle pinning a stream
  const handlePinStream = useCallback(
    async (streamId: string) => {
      if (!bootstrapData) return
      try {
        const res = await fetch(`/api/workspace/${bootstrapData.workspace.id}/streams/${streamId}/pin`, {
          method: "POST",
          credentials: "include",
        })
        if (res.ok) {
          const stream = bootstrapData.streams.find((s) => s.id === streamId)
          if (stream) {
            updateStream({ ...stream, pinnedAt: new Date().toISOString() })
          }
        }
      } catch (error) {
        console.error("Failed to pin stream:", error)
      }
    },
    [bootstrapData, updateStream],
  )

  // Handle unpinning a stream
  const handleUnpinStream = useCallback(
    async (streamId: string) => {
      if (!bootstrapData) return
      try {
        const res = await fetch(`/api/workspace/${bootstrapData.workspace.id}/streams/${streamId}/unpin`, {
          method: "POST",
          credentials: "include",
        })
        if (res.ok) {
          const stream = bootstrapData.streams.find((s) => s.id === streamId)
          if (stream) {
            updateStream({ ...stream, pinnedAt: null })
          }
        }
      } catch (error) {
        console.error("Failed to unpin stream:", error)
      }
    },
    [bootstrapData, updateStream],
  )

  // Handle leaving a stream
  const handleLeaveStream = useCallback(
    async (streamId: string) => {
      if (!bootstrapData) return
      try {
        const res = await fetch(`/api/workspace/${bootstrapData.workspace.id}/streams/${streamId}/leave`, {
          method: "POST",
          credentials: "include",
        })
        if (res.ok) {
          const stream = bootstrapData.streams.find((s) => s.id === streamId)
          if (stream) {
            updateStream({ ...stream, isMember: false })
            // If we're viewing this stream, navigate away
            if (activeStreamSlug === stream.slug) {
              const remainingStreams = bootstrapData.streams.filter(
                (s) => s.id !== streamId && s.isMember && s.streamType === "channel",
              )
              const firstStream = remainingStreams[0]
              if (firstStream) {
                selectStream(firstStream)
              }
            }
          }
        }
      } catch (error) {
        console.error("Failed to leave stream:", error)
      }
    },
    [bootstrapData, updateStream, activeStreamSlug, selectStream],
  )

  // Handle joining a stream from browse modal
  const handleJoinStream = useCallback(
    async (stream: Stream) => {
      if (!bootstrapData) return
      try {
        const res = await fetch(`/api/workspace/${bootstrapData.workspace.id}/streams/${stream.id}/join`, {
          method: "POST",
          credentials: "include",
        })
        if (res.ok) {
          const data = await res.json()
          // Use the stream data from the response if available, otherwise use passed stream
          const joinedStream: Stream = data.stream
            ? {
                ...data.stream,
                isMember: true,
                pinnedAt: null,
              }
            : { ...stream, isMember: true, pinnedAt: null }

          // Check if stream already exists in list (user might have had it from before)
          const existingStream = bootstrapData.streams.find((s) => s.id === stream.id)
          if (existingStream) {
            updateStream(joinedStream)
          } else {
            addStream(joinedStream)
          }

          handleSelectStream(joinedStream)
          setShowBrowseChannels(false)
        }
      } catch (error) {
        console.error("Failed to join stream:", error)
      }
    },
    [bootstrapData, updateStream, addStream, handleSelectStream],
  )

  // Handle creating a new DM
  const handleCreateDM = useCallback(
    async (participantIds: string[]) => {
      if (!bootstrapData) return
      try {
        const res = await fetch(`/api/workspace/${bootstrapData.workspace.id}/streams`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ streamType: "dm", participantIds }),
        })
        if (!res.ok) {
          const error = await res.json()
          throw new Error(error.error || "Failed to create DM")
        }
        const data = await res.json()
        const dmStream: Stream = {
          ...data,
          isMember: true,
          pinnedAt: null,
        }

        // Add or update stream in local state
        const existingStream = bootstrapData.streams.find((s) => s.id === dmStream.id)
        if (existingStream) {
          updateStream(dmStream)
        } else {
          addStream(dmStream)
        }

        // Open the DM
        openItem(
          {
            title: dmStream.name || "Direct Message",
            type: "stream",
            data: { streamId: dmStream.id },
          },
          "replace",
        )
        setShowNewDM(false)
      } catch (error) {
        console.error("Failed to create DM:", error)
        throw error
      }
    },
    [bootstrapData, updateStream, addStream, openItem],
  )

  // Helper to get stream from slug or ID
  const getStreamFromSlug = (streamSlug?: string) => {
    if (!streamSlug || !bootstrapData) return undefined
    return bootstrapData.streams.find((s) => s.slug === streamSlug || s.id === streamSlug)
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
          initialSubTab={(tab.data?.subTab as "unread" | "all") || "unread"}
          onUnreadCountChange={setInboxUnreadCount}
          onSubTabChange={(subTab) => {
            // Update the tab's data with the new subTab to sync URL
            updateTabData(tab.id, { subTab })
          }}
          onNavigateToStream={(streamId, mode = "replace", highlightEventId) => {
            const stream = bootstrapData.streams.find((s) => s.id === streamId)
            // Navigate even if stream isn't in bootstrap data (user might not be a member yet)
            openItem(
              {
                title: stream ? `#${(stream.name || "").replace("#", "")}` : "Channel",
                type: "stream",
                data: { streamId, highlightEventId },
              },
              mode,
              paneId,
            )
          }}
        />
      )
    }

    // Look up stream from slug stored in tab data
    const stream = getStreamFromSlug(tab.data?.streamSlug) || getStreamFromSlug(tab.data?.streamId)
    const actualStreamId = stream?.id || tab.data?.streamSlug || tab.data?.streamId
    const streamName = (stream?.name || "").replace("#", "")

    return (
      <StreamInterface
        workspaceId={bootstrapData.workspace.id}
        streamId={actualStreamId}
        streamName={streamName}
        highlightEventId={tab.data?.highlightEventId}
        title={tab.title}
        users={bootstrapData.users}
        streams={bootstrapData.streams.map((s) => ({
          id: s.id,
          name: s.name || "",
          slug: s.slug || "",
          branchedFromEventId: s.branchedFromEventId,
        }))}
        onOpenThread={(threadIdOrEventId, parentStreamId, mode) => {
          // Find the parent stream to get its slug
          const parentStream = bootstrapData.streams.find((s) => s.id === parentStreamId)
          // For threads, we store the thread/event ID as streamId
          // The parentStreamId is used only for context, not for URL
          openItem(
            {
              title: "Thread",
              type: "stream",
              data: {
                streamId: threadIdOrEventId,
                // Don't use parentStreamId as slug - it's an ID, not a slug
                streamSlug: undefined,
              },
            },
            mode,
            paneId,
          )
        }}
        onGoToStream={(streamSlug, mode) => {
          const targetStream = bootstrapData.streams.find((s) => s.slug === streamSlug || s.id === streamSlug)
          const slug = targetStream?.slug || streamSlug
          const name = (targetStream?.name || "").replace("#", "") || slug

          openItem(
            {
              title: `#${name}`,
              type: "stream",
              data: { streamSlug: slug },
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
        streams={bootstrapData.streams}
        users={bootstrapData.users}
        activeStreamSlug={isActivityActive ? null : activeStreamSlug}
        currentUserId={user?.id}
        onSelectStream={handleSelectStream}
        onStartDM={async (userId) => {
          // Create/find DM with this user and open it
          try {
            const res = await fetch(`/api/workspace/${bootstrapData.workspace.id}/streams`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ streamType: "dm", participantIds: [userId] }),
            })
            if (!res.ok) throw new Error("Failed to create DM")
            const data = await res.json()
            const dmStream: Stream = { ...data, isMember: true, pinnedAt: null }

            // Add or update stream in local state
            const existingStream = bootstrapData.streams.find((s) => s.id === dmStream.id)
            if (existingStream) {
              updateStream(dmStream)
            } else {
              addStream(dmStream)
            }

            openItem(
              { title: dmStream.name || "Direct Message", type: "stream", data: { streamId: dmStream.id } },
              "replace",
            )
          } catch (error) {
            console.error("Failed to start DM:", error)
          }
        }}
        onCreateChannel={() => setShowCreateChannel(true)}
        onCreateDM={() => setShowNewDM(true)}
        onStreamSettings={(stream) => setStreamToEdit(stream)}
        onInvitePeople={() => setShowInviteModal(true)}
        onLogout={logout}
        onOpenCommandPalette={() => setShowCommandPalette(true)}
        onOpenInbox={() => openItem({ title: "Activity", type: "activity", data: {} }, "replace")}
        onBrowseChannels={() => setShowBrowseChannels(true)}
        onPinStream={handlePinStream}
        onUnpinStream={handleUnpinStream}
        onLeaveStream={handleLeaveStream}
        isInboxActive={isActivityActive}
        inboxUnreadCount={inboxUnreadCount}
      />

      <CreateChannelModal
        open={showCreateChannel}
        workspaceId={bootstrapData.workspace.id}
        onClose={() => setShowCreateChannel(false)}
        onCreated={(stream: Stream) => {
          setShowCreateChannel(false)
          addStream(stream)
          handleSelectStream(stream)
        }}
      />

      <ChannelSettingsModal
        open={streamToEdit !== null}
        channel={streamToEdit}
        workspaceId={bootstrapData.workspace.id}
        currentUserId={user?.id}
        isWorkspaceOwner={bootstrapData.userRole === "admin"}
        onClose={() => setStreamToEdit(null)}
        onUpdated={(stream) => {
          updateStream(stream)
          setStreamToEdit(null)
        }}
        onArchived={(streamId) => {
          removeStream(streamId)
          setStreamToEdit(null)
          // If we're viewing the archived stream, navigate away
          if (activeStreamSlug === streamToEdit?.slug) {
            const firstStream = bootstrapData.streams.find((s) => s.id !== streamId && s.streamType === "channel")
            if (firstStream) handleSelectStream(firstStream)
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
        streams={bootstrapData.streams}
        onSelectStream={handleCommandPaletteSelect}
      />

      <BrowseChannelsModal
        open={showBrowseChannels}
        workspaceId={bootstrapData.workspace.id}
        onClose={() => setShowBrowseChannels(false)}
        onJoinStream={handleJoinStream}
        onCreateChannel={() => {
          setShowBrowseChannels(false)
          setShowCreateChannel(true)
        }}
      />

      <NewDMModal
        isOpen={showNewDM}
        onClose={() => setShowNewDM(false)}
        onCreateDM={handleCreateDM}
        users={bootstrapData.users}
        currentUserId={user?.id || ""}
      />
    </div>
  )
}
