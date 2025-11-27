import { useCallback } from "react"
import { useMessageVisibility } from "../../hooks"
import { MessageItem } from "./MessageItem"
import type { Message, OpenMode } from "../../types"

interface MessageItemWithVisibilityProps {
  message: Message
  workspaceId: string
  currentChannelId?: string
  isOwnMessage?: boolean
  isRead?: boolean
  isServerRead?: boolean
  isHighlighted?: boolean
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
  onEdit?: (messageId: string, newContent: string) => Promise<void>
  onMarkAsRead?: (messageId: string) => void
  onMarkAsUnread?: (messageId: string) => void
  onShareToChannel?: (messageId: string) => Promise<void>
  onCrosspostToChannel?: (messageId: string) => void
  onUserMentionClick?: (userId: string) => void
  onChannelClick?: (channelSlug: string, e: React.MouseEvent) => void
  onMessageVisible: (messageId: string) => void
  onMessageHidden: (messageId: string) => void
  onSetRef?: (element: HTMLDivElement | null) => void
  animationDelay?: number
  showThreadActions?: boolean
  users?: Array<{ id: string; name: string; email: string }>
  channels?: Array<{ id: string; name: string; slug: string | null }>
}

export function MessageItemWithVisibility({
  message,
  workspaceId,
  currentChannelId,
  isOwnMessage,
  isRead,
  isServerRead,
  isHighlighted,
  onOpenThread,
  onEdit,
  onMarkAsRead,
  onMarkAsUnread,
  onShareToChannel,
  onCrosspostToChannel,
  onUserMentionClick,
  onChannelClick,
  onMessageVisible,
  onMessageHidden,
  onSetRef,
  animationDelay,
  showThreadActions,
  users,
  channels,
}: MessageItemWithVisibilityProps) {
  const visibilityRef = useMessageVisibility(message.id, onMessageVisible, onMessageHidden)

  // Combine visibility ref with the parent's ref callback
  const combinedRef = useCallback(
    (element: HTMLDivElement | null) => {
      // Set the visibility ref
      if (visibilityRef) {
        (visibilityRef as React.MutableRefObject<HTMLDivElement | null>).current = element
      }
      // Call parent's ref callback
      onSetRef?.(element)
    },
    [visibilityRef, onSetRef],
  )

  return (
    <MessageItem
      message={message}
      workspaceId={workspaceId}
      currentChannelId={currentChannelId}
      isOwnMessage={isOwnMessage}
      isRead={isRead}
      isServerRead={isServerRead}
      isHighlighted={isHighlighted}
      onOpenThread={onOpenThread}
      onEdit={onEdit}
      onMarkAsRead={onMarkAsRead}
      onMarkAsUnread={onMarkAsUnread}
      onShareToChannel={onShareToChannel}
      onCrosspostToChannel={onCrosspostToChannel}
      onUserMentionClick={onUserMentionClick}
      onChannelClick={onChannelClick}
      animationDelay={animationDelay}
      showThreadActions={showThreadActions}
      visibilityRef={combinedRef}
      users={users}
      channels={channels}
    />
  )
}
