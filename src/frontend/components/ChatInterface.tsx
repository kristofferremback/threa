import { useAuth } from "../auth"
import { useChat } from "../hooks"
import { ChatHeader, ChatInput, MessageList, ThreadContext, ConnectionError } from "./chat"
import type { OpenMode } from "../types"

interface ChatInterfaceProps {
  workspaceId: string
  channelId?: string
  channelName?: string
  threadId?: string
  title?: string
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
  onGoToChannel?: (channelId: string, mode: OpenMode) => void
  users?: Array<{ id: string; name: string; email: string }>
  channels?: Array<{ id: string; name: string; slug: string }>
}

export function ChatInterface({
  workspaceId,
  channelId,
  channelName,
  threadId,
  title,
  onOpenThread,
  onGoToChannel,
  users = [],
  channels = [],
}: ChatInterfaceProps) {
  const { isAuthenticated } = useAuth()

  const {
    messages,
    rootMessage,
    ancestors,
    conversationId,
    isLoading,
    isConnected,
    connectionError,
    currentUserId,
    sendMessage,
    editMessage,
  } = useChat({
    workspaceId,
    channelId,
    threadId,
    enabled: isAuthenticated,
  })

  if (!isAuthenticated) {
    return (
      <div className="flex h-full w-full items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <p style={{ color: "var(--text-muted)" }}>Please log in to continue</p>
      </div>
    )
  }

  const isThread = Boolean(threadId)
  const displayTitle = title || "General"

  return (
    <div className="flex h-full w-full flex-col" style={{ background: "var(--bg-primary)", minHeight: "100%" }}>
      <ChatHeader title={displayTitle} isThread={isThread} isConnected={isConnected} />

      {isThread && (
        <ThreadContext
          rootMessage={rootMessage}
          ancestors={ancestors}
          channelName={channelName}
          isLoading={isLoading && !rootMessage}
          onOpenThread={onOpenThread}
          onGoToChannel={onGoToChannel}
          onChannelClick={(slug) => onGoToChannel?.(slug, "replace")}
        />
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {connectionError ? (
          <ConnectionError message={connectionError} />
        ) : (
          <MessageList
            messages={messages}
            workspaceId={workspaceId}
            channelId={channelId}
            conversationId={conversationId || undefined}
            isLoading={isLoading}
            isThread={isThread}
            hasRootMessage={Boolean(rootMessage)}
            currentUserId={currentUserId}
            onOpenThread={onOpenThread}
            onEditMessage={editMessage}
            onChannelClick={(slug) => onGoToChannel?.(slug, "replace")}
            users={users}
            channels={channels}
          />
        )}
      </div>

      <ChatInput
        onSend={sendMessage}
        placeholder={isThread ? "Reply to thread..." : `Message ${displayTitle}`}
        disabled={!isConnected}
        users={users}
        channels={channels}
      />
    </div>
  )
}

export type { OpenMode }
