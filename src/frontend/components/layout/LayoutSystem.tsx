import { useState, useEffect, useCallback } from "react"
import { useAuth } from "../../auth"
import { useBootstrapQuery, usePaneManager, useWorkspaceSocket, usePersonasQuery } from "../../hooks"
import { initSocket } from "../../workers/socket-worker"
import { StreamInterface } from "../StreamInterface"
import { Sidebar } from "./Sidebar"
import { PaneSystem } from "./PaneSystem"
import { CreateWorkspaceModal } from "./CreateWorkspaceModal"
import { CreateChannelModal } from "./CreateChannelModal"
import { ChannelSettingsModal } from "./ChannelSettingsModal"
import { CommandPalette } from "./CommandPalette"
import { BrowseChannelsModal } from "./BrowseChannelsModal"
import { NewDMModal } from "./NewDMModal"
import { ProfileSetupModal } from "./ProfileSetupModal"
import { InviteModal } from "../InviteModal"
import { InboxView } from "./InboxView"
import { KnowledgeBrowserModal } from "./KnowledgeBrowserModal"
import { UserSettingsModal } from "./UserSettingsModal"
import { LoadingScreen, LoginScreen, NoWorkspaceScreen, ErrorScreen } from "./screens"
import { ToolResultPanelProvider, ToolResultPanel } from "../chat/ToolResultViewer"
import { OfflineBanner } from "../OfflineBanner"
import type { Tab, Stream, OpenMode } from "../../types"

export function LayoutSystem() {
  const { isAuthenticated, state, logout, user } = useAuth()
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showNewDM, setShowNewDM] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [commandPaletteMode, setCommandPaletteMode] = useState<"navigate" | "search">("navigate")
  const [showBrowseChannels, setShowBrowseChannels] = useState(false)
  const [showKnowledgeBrowser, setShowKnowledgeBrowser] = useState(false)
  const [showProfileSetup, setShowProfileSetup] = useState(false)
  const [showUserSettings, setShowUserSettings] = useState(false)
  const [streamToEdit, setStreamToEdit] = useState<Stream | null>(null)
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0)
  // Track persona selection per thinking space (streamId -> personaId)
  const [thinkingSpacePersonas, setThinkingSpacePersonas] = useState<Record<string, string>>({})

  // Bootstrap data - uses TanStack Query for offline-first caching
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
    addUser,
    updateUser,
    removeUser,
  } = useBootstrapQuery({
    workspaceId: "default",
    enabled: isAuthenticated && state === "loaded",
  })

  // Personas for @mentions
  const { personas } = usePersonasQuery({
    workspaceId: bootstrapData?.workspace.id,
    enabled: isAuthenticated && !!bootstrapData?.workspace.id,
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
    updateTabsByStreamId,
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

  // Initialize the message socket worker when we have workspace data
  useEffect(() => {
    if (bootstrapData?.workspace.id) {
      initSocket(bootstrapData.workspace.id)
    }
  }, [bootstrapData?.workspace.id])

  // Show profile setup modal if user needs to set up their profile
  useEffect(() => {
    if (bootstrapData) {
      setShowProfileSetup(bootstrapData.needsProfileSetup === true)
    }
  }, [bootstrapData])

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

  // Handle stream updates (name changes, etc.) - update both bootstrap data and tab titles
  const handleStreamUpdated = useCallback(
    (streamId: string, updates: Partial<Stream>) => {
      // Update bootstrap data
      updateStream(streamId, updates)

      // Update tab titles for any tabs showing this stream
      if (updates.name) {
        updateTabsByStreamId(streamId, { title: updates.name })
      }
    },
    [updateStream, updateTabsByStreamId],
  )

  // Workspace-level WebSocket for real-time updates
  const { socket } = useWorkspaceSocket({
    enabled: isAuthenticated && !!bootstrapData,
    workspaceId: bootstrapData?.workspace.id,
    activeStreamSlug: activeStreamSlug || undefined,
    currentUserId: user?.id,
    onStreamAdded: addStream,
    onStreamUpdated: handleStreamUpdated,
    onStreamRemoved: handleStreamRemoved,
    onUnreadCountUpdate: incrementUnreadCount,
    onNewNotification: () => setInboxUnreadCount((prev) => prev + 1),
    onUserAdded: addUser,
    onUserUpdated: updateUser,
    onUserRemoved: removeUser,
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
      // Cmd/Ctrl+P for command palette (channel navigation)
      if ((e.metaKey || e.ctrlKey) && e.key === "p" && !e.shiftKey) {
        e.preventDefault()
        setCommandPaletteMode("navigate")
        setShowCommandPalette((prev) => !prev)
      }
      // Cmd/Ctrl+Shift+F for search
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "f") {
        e.preventDefault()
        setCommandPaletteMode("search")
        setShowCommandPalette(true)
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

  // Handle archiving a stream (e.g., thinking space)
  const handleArchiveStream = useCallback(
    async (streamId: string) => {
      if (!bootstrapData) return

      // If this is a draft thinking space, just remove it locally (no API call needed)
      const isDraft = streamId.startsWith("draft_thinking_space_")

      if (!isDraft) {
        try {
          const res = await fetch(`/api/workspace/${bootstrapData.workspace.id}/streams/${streamId}`, {
            method: "DELETE",
            credentials: "include",
          })
          if (!res.ok) {
            console.error("Failed to archive stream")
            return
          }
        } catch (error) {
          console.error("Failed to archive stream:", error)
          return
        }
      }

      removeStream(streamId)
      // If we're viewing this stream, navigate away
      const stream = bootstrapData.streams.find((s) => s.id === streamId)
      if (stream && activeStreamSlug === stream.slug) {
        const remainingStreams = bootstrapData.streams.filter(
          (s) => s.id !== streamId && s.isMember && s.streamType === "channel",
        )
        const firstStream = remainingStreams[0]
        if (firstStream) {
          selectStream(firstStream)
        }
      }
    },
    [bootstrapData, removeStream, activeStreamSlug, selectStream],
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

  // Handle creating a new thinking space (virtual until first message)
  // personaId is encoded in the draft ID so it can be extracted when creating the real stream
  const handleCreateThinkingSpace = useCallback(
    (personaId: string) => {
      if (!bootstrapData) return

      // Encode personaId in the draft ID so useStreamWithQuery can extract it
      const draftId = `draft_thinking_space_${Date.now()}_${personaId}`
      const draftThinkingSpace: Stream = {
        id: draftId,
        workspaceId: bootstrapData.workspace.id,
        streamType: "thinking_space",
        name: null, // Will be auto-named on first message
        slug: draftId,
        description: null,
        topic: null,
        parentStreamId: null,
        branchedFromEventId: null,
        visibility: "private",
        status: "active",
        isMember: true,
        unreadCount: 0,
        lastReadAt: new Date().toISOString(),
        notifyLevel: "all",
        pinnedAt: null,
      }

      addStream(draftThinkingSpace)

      // Open the draft thinking space
      openItem(
        {
          title: "New thinking space",
          type: "stream",
          data: { streamId: draftId },
        },
        "replace",
      )
    },
    [bootstrapData, addStream, openItem],
  )

  // Callback for navigating to a specific event from tool results
  const handleNavigateToEvent = useCallback(
    (streamId: string, eventId: string) => {
      if (!bootstrapData) return
      const stream = bootstrapData.streams.find((s) => s.id === streamId)
      openItem(
        {
          title: stream ? `#${(stream.name || "").replace("#", "")}` : "Message",
          type: "stream",
          data: { streamId, highlightEventId: eventId },
        },
        "open",
      )
    },
    [bootstrapData, openItem],
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

    // For thinking spaces, get selected persona from state or extract from draft ID
    const isThinkingSpace =
      stream?.streamType === "thinking_space" || actualStreamId?.startsWith("draft_thinking_space_")
    let selectedPersonaId: string | null = null
    if (isThinkingSpace && actualStreamId) {
      // First check state, then try to extract from draft ID
      selectedPersonaId = thinkingSpacePersonas[actualStreamId] || null
      if (!selectedPersonaId && actualStreamId.startsWith("draft_thinking_space_")) {
        // Extract personaId from draft ID: draft_thinking_space_{timestamp}_{personaId}
        // parts: ["draft", "thinking", "space", timestamp, personaId, ...]
        const parts = actualStreamId.split("_")
        if (parts.length >= 5) {
          selectedPersonaId = parts.slice(4).join("_") // Join in case personaId has underscores
        }
      }
      // If still no persona, use default
      if (!selectedPersonaId) {
        const defaultPersona = personas.find((p) => p.isDefault) || personas[0]
        selectedPersonaId = defaultPersona?.id || null
      }
    }

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
          slug: s.slug, // Keep null for DMs - allows filtering in crosspost suggestions
          branchedFromEventId: s.branchedFromEventId,
        }))}
        agents={personas.map((p) => ({ ...p, isDefault: p.isDefault }))}
        selectedPersonaId={isThinkingSpace ? selectedPersonaId : undefined}
        onPersonaChange={
          isThinkingSpace && actualStreamId
            ? (personaId) => {
                setThinkingSpacePersonas((prev) => ({ ...prev, [actualStreamId]: personaId }))
              }
            : undefined
        }
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
        onStreamMaterialized={(draftId, realStream) => {
          // Draft thinking space was materialized - update bootstrap and tab data
          removeStream(draftId)
          addStream(realStream)
          // Update the current tab to point to the real stream
          // For thinking spaces, use streamId only (not slug) for more reliable URL
          updateTabData(tab.id, { streamId: realStream.id, streamSlug: null })
          // Migrate persona state from draft ID to real stream ID
          setThinkingSpacePersonas((prev) => {
            const personaId = prev[draftId]
            if (personaId) {
              const { [draftId]: _, ...rest } = prev
              return { ...rest, [realStream.id]: personaId }
            }
            return prev
          })
        }}
        onStreamUpdate={(updatedStream) => {
          // Stream data changed (e.g., auto-named thread/thinking space) - update tab title
          if (updatedStream.name) {
            updateTabsByStreamId(updatedStream.id, { title: updatedStream.name })
          }
          // Also update bootstrap data
          updateStream(updatedStream.id, { name: updatedStream.name })
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
    <ToolResultPanelProvider onNavigateToEvent={handleNavigateToEvent}>
      <div className="flex flex-col h-screen w-full overflow-hidden" style={{ background: "var(--bg-primary)" }}>
        <OfflineBanner />
        <div className="flex flex-1 min-h-0">
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
            onCreateThinkingSpace={() => {
              const defaultPersona = personas.find((p) => p.isDefault) || personas[0]
              if (defaultPersona) {
                handleCreateThinkingSpace(defaultPersona.id)
              }
            }}
            onStreamSettings={(stream) => setStreamToEdit(stream)}
            onEditProfile={() => setShowProfileSetup(true)}
            onInvitePeople={() => setShowInviteModal(true)}
            onLogout={logout}
            onOpenCommandPalette={() => setShowCommandPalette(true)}
            onOpenInbox={() => openItem({ title: "Activity", type: "activity", data: {} }, "replace")}
            onOpenKnowledge={() => setShowKnowledgeBrowser(true)}
            onBrowseChannels={() => setShowBrowseChannels(true)}
            onOpenSettings={() => setShowUserSettings(true)}
            onPinStream={handlePinStream}
            onUnpinStream={handleUnpinStream}
            onLeaveStream={handleLeaveStream}
            onArchiveStream={handleArchiveStream}
            isInboxActive={isActivityActive}
            inboxUnreadCount={inboxUnreadCount}
            currentUserProfile={bootstrapData.userProfile}
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
            mode={commandPaletteMode}
            onClose={() => setShowCommandPalette(false)}
            streams={bootstrapData.streams}
            users={bootstrapData.users}
            workspaceId={bootstrapData.workspace.id}
            onSelectStream={handleCommandPaletteSelect}
            onNavigateToMessage={(streamSlugOrId, eventId, mode) => {
              // Try to find stream by slug first, then by id (for threads which don't have slugs)
              const stream =
                bootstrapData.streams.find((s) => s.slug === streamSlugOrId) ||
                bootstrapData.streams.find((s) => s.id === streamSlugOrId)
              const isThread = stream?.streamType === "thread" || stream?.streamType === "thinking_space"
              const streamTab = {
                title: stream
                  ? isThread
                    ? stream.name || "Thread"
                    : `#${(stream.name || "").replace("#", "")}`
                  : `#${streamSlugOrId}`,
                type: "stream" as const,
                data: {
                  streamSlug: stream?.slug || undefined,
                  streamId: stream?.id || streamSlugOrId,
                  highlightEventId: eventId,
                },
              }
              openItem(streamTab, mode)
            }}
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

          <KnowledgeBrowserModal
            isOpen={showKnowledgeBrowser}
            onClose={() => setShowKnowledgeBrowser(false)}
            workspaceId={bootstrapData.workspace.id}
            onNavigateToStream={(streamId) => {
              setShowKnowledgeBrowser(false)
              const stream = bootstrapData.streams.find((s) => s.id === streamId)
              if (stream) {
                handleSelectStream(stream)
              } else {
                openItem({ title: "Channel", type: "stream", data: { streamId } }, "replace")
              }
            }}
          />

          <NewDMModal
            isOpen={showNewDM}
            onClose={() => setShowNewDM(false)}
            onCreateDM={handleCreateDM}
            users={bootstrapData.users}
            currentUserId={user?.id || ""}
          />

          <ProfileSetupModal
            isOpen={showProfileSetup}
            workspaceId={bootstrapData.workspace.id}
            workspaceName={bootstrapData.workspace.name}
            currentProfile={bootstrapData.userProfile}
            onComplete={() => {
              setShowProfileSetup(false)
              refetchBootstrap()
            }}
            onSkip={() => setShowProfileSetup(false)}
            canSkip={true}
          />

          <UserSettingsModal
            isOpen={showUserSettings}
            workspaceId={bootstrapData.workspace.id}
            onClose={() => setShowUserSettings(false)}
          />

          {/* Tool result viewer panel */}
          <ToolResultPanel />
        </div>
      </div>
    </ToolResultPanelProvider>
  )
}
