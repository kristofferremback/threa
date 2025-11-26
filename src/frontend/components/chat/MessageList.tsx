import { useRef, useEffect, useMemo, useCallback } from "react"
import { Hash, MessageCircle, ChevronUp, CheckCheck } from "lucide-react"
import { MessageItem } from "./MessageItem"
import { MessageItemWithVisibility } from "./MessageItemWithVisibility"
import { SystemMessage } from "./SystemMessage"
import { EmptyState, LoadingState } from "../ui"
import { useReadReceipts } from "../../hooks"
import type { Message, OpenMode } from "../../types"

interface MessageListProps {
  messages: Message[]
  workspaceId: string
  channelId?: string
  conversationId?: string
  lastReadMessageId?: string | null
  isLoading: boolean
  isThread?: boolean
  hasRootMessage?: boolean
  currentUserId?: string | null
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
  onEditMessage?: (messageId: string, newContent: string) => Promise<void>
  onMarkAllAsRead?: () => Promise<void>
  onUpdateLastRead?: (messageId: string | null) => void
  onUserMentionClick?: (userId: string) => void
  onChannelClick?: (channelSlug: string) => void
  showThreadActions?: boolean
  users?: Array<{ id: string; name: string; email: string }>
  channels?: Array<{ id: string; name: string; slug: string }>
}

export function MessageList({
  messages,
  workspaceId,
  channelId,
  conversationId,
  lastReadMessageId,
  isLoading,
  isThread = false,
  hasRootMessage = false,
  currentUserId,
  onOpenThread,
  onEditMessage,
  onMarkAllAsRead,
  onUpdateLastRead,
  onUserMentionClick,
  onChannelClick,
  showThreadActions = true,
  users = [],
  channels = [],
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const unreadDividerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { onMessageVisible, onMessageHidden, markAsRead, markAsUnread } = useReadReceipts({
    workspaceId,
    channelId,
    conversationId,
    enabled: Boolean(channelId || conversationId),
  })

  // Calculate which messages are read/unread based on lastReadMessageId
  const { readMessageIds, firstUnreadIndex, unreadCount } = useMemo(() => {
    if (!lastReadMessageId || messages.length === 0) {
      // If no read cursor, all messages are unread (except for brand new channels)
      return {
        readMessageIds: new Set<string>(),
        firstUnreadIndex: 0,
        unreadCount: messages.length,
      }
    }

    const readIds = new Set<string>()
    let foundLastRead = false
    let firstUnread = -1

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (!foundLastRead) {
        readIds.add(msg.id)
        if (msg.id === lastReadMessageId) {
          foundLastRead = true
        }
      } else {
        if (firstUnread === -1) {
          firstUnread = i
        }
      }
    }

    return {
      readMessageIds: readIds,
      firstUnreadIndex: firstUnread,
      unreadCount: firstUnread === -1 ? 0 : messages.length - firstUnread,
    }
  }, [messages, lastReadMessageId])

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
        onUpdateLastRead?.(messages[msgIndex - 1].id)
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

  // Track previous message count to detect new messages vs channel switch
  const prevMessageCountRef = useRef(0)
  const prevMessagesKeyRef = useRef("")

  // Scroll handling - runs once after render
  useEffect(() => {
    if (messages.length === 0) return

    // Create a key based on channel/conversation to detect switches
    const currentKey = `${channelId || ""}-${conversationId || ""}`
    const isChannelSwitch = currentKey !== prevMessagesKeyRef.current
    const isNewMessages = messages.length > prevMessageCountRef.current

    // Update refs
    prevMessagesKeyRef.current = currentKey
    prevMessageCountRef.current = messages.length

    if (isChannelSwitch) {
      // Channel switch: instant scroll to bottom, use RAF to ensure DOM is ready
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "instant" })
      })
    } else if (isNewMessages && isNearBottom()) {
      // New messages while near bottom: smooth scroll
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
    // If not near bottom and not a channel switch, don't auto-scroll
  }, [messages, channelId, conversationId])

  if (isLoading) {
    return <LoadingState message="Loading messages..." />
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
    <div ref={containerRef} className="flex-1 overflow-y-auto p-4 min-h-0">
      {messages.map((msg, idx) =>
        msg.messageType === "system" ? (
          <SystemMessage key={msg.id || msg.timestamp} message={msg} animationDelay={Math.min(idx * 30, 300)} />
        ) : (
          <MessageItemWithVisibility
            key={msg.id || msg.timestamp}
            message={msg}
            workspaceId={workspaceId}
            currentChannelId={channelId}
            isOwnMessage={currentUserId ? msg.userId === currentUserId : false}
            onOpenThread={onOpenThread}
            onEdit={onEditMessage}
            onMarkAsRead={markAsRead}
            onMarkAsUnread={markAsUnread}
            onUserMentionClick={onUserMentionClick}
            onChannelClick={onChannelClick}
            onMessageVisible={onMessageVisible}
            onMessageHidden={onMessageHidden}
            animationDelay={Math.min(idx * 30, 300)}
            showThreadActions={showThreadActions}
            users={users}
            channels={channels}
          />
        ),
      )}
      <div ref={messagesEndRef} />
    </div>
  )
}
