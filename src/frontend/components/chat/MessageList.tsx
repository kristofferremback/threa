import { useRef, useEffect } from "react"
import { Hash, MessageCircle } from "lucide-react"
import { MessageItem } from "./MessageItem"
import { EmptyState, LoadingState } from "../ui"
import type { Message, OpenMode } from "../../types"

interface MessageListProps {
  messages: Message[]
  workspaceId: string
  isLoading: boolean
  isThread?: boolean
  hasRootMessage?: boolean
  currentUserId?: string | null
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
  onEditMessage?: (messageId: string, newContent: string) => Promise<void>
  showThreadActions?: boolean
}

export function MessageList({
  messages,
  workspaceId,
  isLoading,
  isThread = false,
  hasRootMessage = false,
  currentUserId,
  onOpenThread,
  onEditMessage,
  showThreadActions = true,
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

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
      {messages.map((msg, idx) => (
        <MessageItem
          key={msg.id || msg.timestamp}
          message={msg}
          workspaceId={workspaceId}
          isOwnMessage={currentUserId ? msg.userId === currentUserId : false}
          onOpenThread={onOpenThread}
          onEdit={onEditMessage}
          animationDelay={Math.min(idx * 30, 300)}
          showThreadActions={showThreadActions}
        />
      ))}
      <div ref={messagesEndRef} />
    </div>
  )
}
