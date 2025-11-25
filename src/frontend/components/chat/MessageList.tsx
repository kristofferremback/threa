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
  showThreadActions?: boolean
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
  showThreadActions = true,
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

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
    <div className="flex-1 overflow-y-auto p-4 min-h-0">
      {messages.map((msg, idx) =>
        msg.messageType === "system" ? (
          <SystemMessage key={msg.id || msg.timestamp} message={msg} animationDelay={Math.min(idx * 30, 300)} />
        ) : (
          <MessageItemWithVisibility
            key={msg.id || msg.timestamp}
            message={msg}
            workspaceId={workspaceId}
            isOwnMessage={currentUserId ? msg.userId === currentUserId : false}
            onOpenThread={onOpenThread}
            onEdit={onEditMessage}
            onMarkAsRead={markAsRead}
            onMarkAsUnread={markAsUnread}
            onMessageVisible={onMessageVisible}
            onMessageHidden={onMessageHidden}
            animationDelay={Math.min(idx * 30, 300)}
            showThreadActions={showThreadActions}
          />
        ),
      )}
      <div ref={messagesEndRef} />
    </div>
  )
}
