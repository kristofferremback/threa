import { useRef, useEffect } from "react"
import { Hash, MessageCircle } from "lucide-react"
import { MessageItem } from "./MessageItem"
import { EmptyState, LoadingState } from "../ui"
import type { Message, OpenMode } from "../../types"

interface MessageListProps {
  messages: Message[]
  isLoading: boolean
  isThread?: boolean
  hasRootMessage?: boolean
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
  showThreadActions?: boolean
}

export function MessageList({
  messages,
  isLoading,
  isThread = false,
  hasRootMessage = false,
  onOpenThread,
  showThreadActions = true,
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  if (isLoading) {
    return <LoadingState message="Loading messages..." />
  }

  // Empty states
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
          onOpenThread={onOpenThread}
          animationDelay={Math.min(idx * 30, 300)}
          showThreadActions={showThreadActions}
        />
      ))}
      <div ref={messagesEndRef} />
    </div>
  )
}
