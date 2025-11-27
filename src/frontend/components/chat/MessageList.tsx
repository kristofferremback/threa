import { useRef, useEffect, useLayoutEffect, useMemo, useCallback, useState } from "react"
import { Hash, MessageCircle, ChevronUp, CheckCheck } from "lucide-react"
import { MessageItem } from "./MessageItem"
import { MessageItemWithVisibility } from "./MessageItemWithVisibility"
import { SystemMessage } from "./SystemMessage"
import { EmptyState } from "../ui"
import { useReadReceipts } from "../../hooks"
import type { Message, OpenMode } from "../../types"

interface MessageListProps {
  messages: Message[]
  workspaceId: string
  channelId?: string // Now treated as streamId
  lastReadMessageId?: string | null
  isLoading: boolean
  isLoadingMore?: boolean
  hasMoreMessages?: boolean
  isThread?: boolean
  hasRootMessage?: boolean
  currentUserId?: string | null
  highlightMessageId?: string
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
  onEditMessage?: (messageId: string, newContent: string) => Promise<void>
  onLoadMore?: () => Promise<void>
  onMarkAllAsRead?: () => Promise<void>
  onUpdateLastRead?: (messageId: string | null) => void
  onShareToChannel?: (messageId: string) => Promise<void>
  onCrosspostToChannel?: (messageId: string, targetChannelId: string) => Promise<void>
  onUserMentionClick?: (userId: string) => void
  onChannelClick?: (channelSlug: string, e: React.MouseEvent) => void
  showThreadActions?: boolean
  users?: Array<{ id: string; name: string; email: string }>
  channels?: Array<{ id: string; name: string; slug: string | null }>
}

export function MessageList({
  messages,
  workspaceId,
  channelId, // Now treated as streamId
  lastReadMessageId,
  isLoading,
  isLoadingMore = false,
  hasMoreMessages = true,
  isThread = false,
  hasRootMessage = false,
  currentUserId,
  highlightMessageId,
  onOpenThread,
  onEditMessage,
  onLoadMore,
  onMarkAllAsRead,
  onUpdateLastRead,
  onShareToChannel,
  onCrosspostToChannel,
  onUserMentionClick,
  onChannelClick,
  showThreadActions = true,
  users = [],
  channels = [],
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const unreadDividerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const messageRefsMap = useRef<Map<string, HTMLDivElement>>(new Map())

  // Track which message is currently highlighted (for timed highlighting)
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null)

  // Track locally seen messages for immediate UI update
  const [locallySeenIds, setLocallySeenIds] = useState<Set<string>>(new Set())

  // Cross-post modal state
  const [crosspostModalMessageId, setCrosspostModalMessageId] = useState<string | null>(null)

  const {
    onMessageVisible: baseOnMessageVisible,
    onMessageHidden,
    markAsRead,
    markAsUnread,
  } = useReadReceipts({
    workspaceId,
    streamId: channelId,
    enabled: Boolean(channelId),
  })

  // Wrap onMessageVisible to also update local state for immediate UI feedback
  const onMessageVisible = useCallback(
    (messageId: string) => {
      // Call the base handler for server-side tracking
      baseOnMessageVisible(messageId)
      // Update local state for immediate visual feedback
      setLocallySeenIds((prev) => {
        if (prev.has(messageId)) return prev
        const next = new Set(prev)
        next.add(messageId)
        return next
      })
    },
    [baseOnMessageVisible],
  )

  // Reset locally seen messages when stream changes
  useEffect(() => {
    setLocallySeenIds(new Set())
  }, [channelId])

  // Calculate which messages are read/unread
  // We track TWO sets:
  // 1. readMessageIds - for visual indicators (blue border), includes locally seen for immediate feedback
  // 2. serverReadMessageIds - for context menu actions and divider, based only on server state
  // Own messages are NOT special-cased here - they're auto-marked as read when sent (server-side)
  const { readMessageIds, serverReadMessageIds, firstUnreadIndex, unreadCount } = useMemo(() => {
    if (messages.length === 0) {
      return {
        readMessageIds: new Set<string>(),
        serverReadMessageIds: new Set<string>(),
        firstUnreadIndex: -1,
        unreadCount: 0,
      }
    }

    const readIds = new Set<string>() // For visual indicators (includes locally seen)
    const serverReadIds = new Set<string>() // For context menu (server state only)
    let foundLastRead = !lastReadMessageId // If no cursor, start tracking unread from beginning
    let serverFirstUnread = -1

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!
      const isLocallyRead = locallySeenIds.has(msg.id)

      if (!foundLastRead) {
        readIds.add(msg.id)
        serverReadIds.add(msg.id)
        if (msg.id === lastReadMessageId) {
          foundLastRead = true
        }
      } else {
        // Track server-based first unread (for divider)
        if (serverFirstUnread === -1) {
          serverFirstUnread = i
        }
        // After the last read cursor, messages are unread on server
        // But may be locally seen for visual feedback
        if (isLocallyRead) {
          readIds.add(msg.id)
        }
        // serverReadIds does NOT include locally seen - only server confirmed
      }
    }

    return {
      readMessageIds: readIds,
      serverReadMessageIds: serverReadIds,
      firstUnreadIndex: serverFirstUnread, // Based only on server state
      unreadCount: serverFirstUnread === -1 ? 0 : messages.length - serverFirstUnread,
    }
  }, [messages, lastReadMessageId, locallySeenIds])

  // Handle marking a message as read (updates local state too)
  const handleMarkAsRead = useCallback(
    (messageId: string) => {
      markAsRead(messageId)
      // Optimistically update the local read cursor
      onUpdateLastRead?.(messageId)
    },
    [markAsRead, onUpdateLastRead],
  )

  // Handle marking a message as unread
  const handleMarkAsUnread = useCallback(
    (messageId: string) => {
      markAsUnread(messageId)
      // Find the message before this one to set as the new read cursor
      const msgIndex = messages.findIndex((m) => m.id === messageId)
      if (msgIndex > 0) {
        onUpdateLastRead?.(messages[msgIndex - 1]!.id)
      } else {
        onUpdateLastRead?.(null)
      }
    },
    [markAsUnread, messages, onUpdateLastRead],
  )

  const scrollToUnread = useCallback(() => {
    unreadDividerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [])

  // Check if user is near the bottom of the scroll container
  const isNearBottom = () => {
    const container = containerRef.current
    if (!container) return true
    const threshold = 150 // pixels from bottom
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold
  }

  // Check if user is near the top of the scroll container (for loading more)
  const isNearTop = () => {
    const container = containerRef.current
    if (!container) return false
    const threshold = 100 // pixels from top
    return container.scrollTop < threshold
  }

  // Track previous message count to detect new messages vs channel switch
  const prevMessageCountRef = useRef(0)
  const prevMessagesKeyRef = useRef("")
  const hasScrolledToUnreadRef = useRef(false)
  const prevScrollStateRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)

  // Handle scroll for infinite loading
  const handleScroll = useCallback(() => {
    if (isNearTop() && hasMoreMessages && !isLoadingMore && onLoadMore) {
      const container = containerRef.current
      if (container) {
        // Save both scroll height AND current scroll position before loading
        prevScrollStateRef.current = {
          scrollHeight: container.scrollHeight,
          scrollTop: container.scrollTop,
        }
      }
      onLoadMore()
    }
  }, [hasMoreMessages, isLoadingMore, onLoadMore])

  // Restore scroll position after loading more messages
  useEffect(() => {
    if (!isLoadingMore && prevScrollStateRef.current) {
      const container = containerRef.current
      if (container) {
        const { scrollHeight: prevHeight, scrollTop: prevTop } = prevScrollStateRef.current
        const newScrollHeight = container.scrollHeight
        const heightAdded = newScrollHeight - prevHeight
        // Maintain the same visual position by adding the height of new content
        container.scrollTop = prevTop + heightAdded
        prevScrollStateRef.current = null
      }
    }
  }, [isLoadingMore, messages])

  // Scroll handling - use useLayoutEffect to scroll BEFORE browser paints
  // This prevents the visual "flash" where content appears at wrong scroll position
  useLayoutEffect(() => {
    if (messages.length === 0) return

    // Create a key based on stream to detect switches
    const currentKey = channelId || ""
    const isChannelSwitch = currentKey !== prevMessagesKeyRef.current
    const isNewMessages = messages.length > prevMessageCountRef.current

    // Update refs
    prevMessagesKeyRef.current = currentKey
    prevMessageCountRef.current = messages.length

    if (isChannelSwitch) {
      hasScrolledToUnreadRef.current = false
      // Channel switch: check if there are unread messages to scroll to
      if (firstUnreadIndex > 0 && !hasScrolledToUnreadRef.current) {
        // Scroll to the first unread message
        const firstUnreadMsg = messages[firstUnreadIndex]
        if (firstUnreadMsg) {
          const element = messageRefsMap.current.get(firstUnreadMsg.id)
          if (element) {
            element.scrollIntoView({ behavior: "instant", block: "center" })
            hasScrolledToUnreadRef.current = true
            return
          }
        }
      }
      // No unread messages or new channel - scroll to bottom
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" })
      hasScrolledToUnreadRef.current = true
    } else if (isNewMessages && isNearBottom()) {
      // New messages while near bottom: smooth scroll
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
    // If not near bottom and not a channel switch, don't auto-scroll
  }, [messages, channelId, firstUnreadIndex])

  // Handle scrolling to and highlighting a specific message
  useEffect(() => {
    if (!highlightMessageId || messages.length === 0) {
      setActiveHighlightId(null)
      return
    }

    // Check if the message exists in the current messages
    const messageExists = messages.some((m) => m.id === highlightMessageId)
    if (!messageExists) {
      setActiveHighlightId(null)
      return
    }

    // Wait for the next frame to ensure the message element is rendered
    requestAnimationFrame(() => {
      const messageElement = messageRefsMap.current.get(highlightMessageId)
      if (messageElement) {
        // Scroll the message into view
        messageElement.scrollIntoView({ behavior: "smooth", block: "center" })
        // Activate highlight
        setActiveHighlightId(highlightMessageId)

        // Clear highlight after 5 seconds
        const timer = setTimeout(() => {
          setActiveHighlightId(null)
        }, 5000)

        return () => clearTimeout(timer)
      }
    })
  }, [highlightMessageId, messages])

  // Callback to register message refs
  const setMessageRef = useCallback((messageId: string, element: HTMLDivElement | null) => {
    if (element) {
      messageRefsMap.current.set(messageId, element)
    } else {
      messageRefsMap.current.delete(messageId)
    }
  }, [])

  if (isLoading) {
    // Use same container structure as message list to prevent layout shift
    return (
      <div className="flex-1 overflow-y-auto p-4 min-h-0 flex items-center justify-center">
        <div className="text-center">
          <div
            className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent mx-auto mb-2"
            style={{ borderColor: "var(--text-muted)", borderTopColor: "transparent" }}
          />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Loading messages...
          </p>
        </div>
      </div>
    )
  }

  if (messages.length === 0) {
    if (isThread && hasRootMessage) {
      return <EmptyState icon={MessageCircle} description="No replies yet. Start the conversation!" />
    }

    if (!isThread) {
      return <EmptyState icon={Hash} description="No messages yet. Say hello!" />
    }
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 min-h-0"
      style={{ overflowAnchor: "none" }} // Disable scroll anchoring to prevent browser interference
      onScroll={handleScroll}
    >
      {/* Loading indicator at top */}
      {isLoadingMore && (
        <div className="flex justify-center py-3">
          <div
            className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: "var(--text-muted)", borderTopColor: "transparent" }}
          />
        </div>
      )}

      {/* "Load more" button if there are more messages */}
      {!isLoadingMore && hasMoreMessages && onLoadMore && (
        <div className="flex justify-center py-2">
          <button
            onClick={onLoadMore}
            className="text-xs px-3 py-1 rounded-full transition-colors"
            style={{ color: "var(--text-muted)", background: "var(--bg-tertiary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay-strong)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-tertiary)")}
          >
            Load older messages
          </button>
        </div>
      )}

      {messages.map((msg, idx) => {
        const isRead = readMessageIds.has(msg.id) // For visual indicators (includes locally seen)
        const isServerRead = serverReadMessageIds.has(msg.id) // For context menu actions
        const showUnreadDivider = idx === firstUnreadIndex && firstUnreadIndex > 0

        return (
          <div key={msg.id || msg.timestamp}>
            {/* Unread divider */}
            {showUnreadDivider && (
              <div ref={unreadDividerRef} className="flex items-center gap-3 my-3" style={{ color: "var(--error)" }}>
                <div className="flex-1 h-px" style={{ background: "var(--error)" }} />
                <span className="text-xs font-medium uppercase">New messages</span>
                <div className="flex-1 h-px" style={{ background: "var(--error)" }} />
              </div>
            )}

            {msg.messageType === "system" ? (
              <SystemMessage message={msg} animationDelay={Math.min(idx * 30, 300)} />
            ) : (
              <MessageItemWithVisibility
                message={msg}
                workspaceId={workspaceId}
                currentChannelId={channelId}
                isOwnMessage={currentUserId ? msg.userId === currentUserId : false}
                isRead={isRead}
                isServerRead={isServerRead}
                isHighlighted={msg.id === activeHighlightId}
                onOpenThread={onOpenThread}
                onEdit={onEditMessage}
                onMarkAsRead={markAsRead}
                onMarkAsUnread={markAsUnread}
                onShareToChannel={onShareToChannel}
                onCrosspostToChannel={(messageId) => setCrosspostModalMessageId(messageId)}
                onUserMentionClick={onUserMentionClick}
                onChannelClick={onChannelClick}
                onMessageVisible={onMessageVisible}
                onMessageHidden={onMessageHidden}
                onSetRef={(el) => setMessageRef(msg.id, el)}
                animationDelay={Math.min(idx * 30, 300)}
                showThreadActions={showThreadActions}
                users={users}
                channels={channels}
              />
            )}
          </div>
        )
      })}
      <div ref={messagesEndRef} />

      {/* Cross-post channel selector modal */}
      {crosspostModalMessageId && (
        <CrosspostModal
          channels={channels.filter((c) => c.id !== channelId)} // Exclude current channel
          onClose={() => setCrosspostModalMessageId(null)}
          onSelect={async (targetChannelId) => {
            if (onCrosspostToChannel && crosspostModalMessageId) {
              await onCrosspostToChannel(crosspostModalMessageId, targetChannelId)
            }
            setCrosspostModalMessageId(null)
          }}
        />
      )}
    </div>
  )
}

// Simple modal for selecting a channel to cross-post to
function CrosspostModal({
  channels,
  onClose,
  onSelect,
}: {
  channels: Array<{ id: string; name: string; slug: string }>
  onClose: () => void
  onSelect: (channelId: string) => void
}) {
  const [search, setSearch] = useState("")
  const filteredChannels = channels.filter(
    (c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.slug.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div
        className="relative w-full max-w-md rounded-lg shadow-xl p-4"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}
      >
        <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          Cross-post to channel
        </h3>

        {/* Search input */}
        <input
          type="text"
          placeholder="Search channels..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 rounded-lg text-sm mb-3"
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-default)",
            color: "var(--text-primary)",
          }}
          autoFocus
        />

        {/* Channel list */}
        <div className="max-h-64 overflow-y-auto space-y-1">
          {filteredChannels.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: "var(--text-muted)" }}>
              No channels found
            </p>
          ) : (
            filteredChannels.map((channel) => (
              <button
                key={channel.id}
                onClick={() => onSelect(channel.id)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors"
                style={{ color: "var(--text-primary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Hash className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
                <span>{channel.name.replace("#", "")}</span>
                <span className="text-xs ml-auto" style={{ color: "var(--text-muted)" }}>
                  {channel.slug}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Cancel button */}
        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
