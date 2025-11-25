import { useMessageVisibility } from "../../hooks"
import { MessageItem } from "./MessageItem"
import type { Message, OpenMode } from "../../types"

interface MessageItemWithVisibilityProps {
  message: Message
  workspaceId: string
  isOwnMessage?: boolean
  isRead?: boolean
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
  onEdit?: (messageId: string, newContent: string) => Promise<void>
  onMarkAsRead?: (messageId: string) => void
  onMarkAsUnread?: (messageId: string) => void
  onMessageVisible: (messageId: string) => void
  onMessageHidden: (messageId: string) => void
  animationDelay?: number
  showThreadActions?: boolean
}

export function MessageItemWithVisibility({
  message,
  workspaceId,
  isOwnMessage,
  isRead,
  onOpenThread,
  onEdit,
  onMarkAsRead,
  onMarkAsUnread,
  onMessageVisible,
  onMessageHidden,
  animationDelay,
  showThreadActions,
}: MessageItemWithVisibilityProps) {
  const visibilityRef = useMessageVisibility(message.id, onMessageVisible, onMessageHidden)

  return (
    <MessageItem
      message={message}
      workspaceId={workspaceId}
      isOwnMessage={isOwnMessage}
      isRead={isRead}
      onOpenThread={onOpenThread}
      onEdit={onEdit}
      onMarkAsRead={onMarkAsRead}
      onMarkAsUnread={onMarkAsUnread}
      animationDelay={animationDelay}
      showThreadActions={showThreadActions}
      visibilityRef={visibilityRef}
    />
  )
}

