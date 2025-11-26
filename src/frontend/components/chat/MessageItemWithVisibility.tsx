import { useMessageVisibility } from "../../hooks"
import { MessageItem } from "./MessageItem"
import type { Message, OpenMode } from "../../types"

interface MessageItemWithVisibilityProps {
  message: Message
  workspaceId: string
  currentChannelId?: string
  isOwnMessage?: boolean
  isRead?: boolean
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
  onEdit?: (messageId: string, newContent: string) => Promise<void>
  onMarkAsRead?: (messageId: string) => void
  onMarkAsUnread?: (messageId: string) => void
  onUserMentionClick?: (userId: string) => void
  onChannelClick?: (channelSlug: string) => void
  onMessageVisible: (messageId: string) => void
  onMessageHidden: (messageId: string) => void
  animationDelay?: number
  showThreadActions?: boolean
  users?: Array<{ id: string; name: string; email: string }>
  channels?: Array<{ id: string; name: string; slug: string }>
}

export function MessageItemWithVisibility({
  message,
  workspaceId,
  currentChannelId,
  isOwnMessage,
  isRead,
  onOpenThread,
  onEdit,
  onMarkAsRead,
  onMarkAsUnread,
  onUserMentionClick,
  onChannelClick,
  onMessageVisible,
  onMessageHidden,
  animationDelay,
  showThreadActions,
  users,
  channels,
}: MessageItemWithVisibilityProps) {
  const visibilityRef = useMessageVisibility(message.id, onMessageVisible, onMessageHidden)

  return (
    <MessageItem
      message={message}
      workspaceId={workspaceId}
      currentChannelId={currentChannelId}
      isOwnMessage={isOwnMessage}
      isRead={isRead}
      onOpenThread={onOpenThread}
      onEdit={onEdit}
      onMarkAsRead={onMarkAsRead}
      onMarkAsUnread={onMarkAsUnread}
      onUserMentionClick={onUserMentionClick}
      onChannelClick={onChannelClick}
      animationDelay={animationDelay}
      showThreadActions={showThreadActions}
      visibilityRef={visibilityRef}
      users={users}
      channels={channels}
    />
  )
}
