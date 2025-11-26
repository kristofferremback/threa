import { useCallback } from "react"
import { toast } from "sonner"
import { useChat } from "../hooks"
import { ChatHeader, ChatInput, MessageList, ThreadContext, ConnectionError } from "./chat"
import type { OpenMode } from "../types"

interface ChatInterfaceProps {
  workspaceId: string
  channelId?: string
  channelName?: string
  threadId?: string
  highlightMessageId?: string
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
  highlightMessageId,
  title,
  onOpenThread,
  onGoToChannel,
  users = [],
  channels = [],
}: ChatInterfaceProps) {
  // Note: Authentication is already handled by LayoutSystem - this component
  // is only rendered when the user is authenticated
  const {
    messages,
    rootMessage,
    ancestors,
    conversationId,
    lastReadMessageId,
    isLoading,
    isLoadingMore,
    hasMoreMessages,
    isConnected,
    connectionError,
    currentUserId,
    sendMessage,
    editMessage,
    loadMoreMessages,
  } = useChat({
    workspaceId,
    channelId,
    threadId,
    enabled: true, // Always enabled - LayoutSystem guards authentication
  })

  const isThread = Boolean(threadId)
  const displayTitle = title || "General"

  // Handler for sharing a thread reply to its parent channel
  const handleShareToChannel = useCallback(
    async (messageId: string) => {
      try {
        const res = await fetch(`/api/workspace/${workspaceId}/messages/${messageId}/share-to-channel`, {
          method: "POST",
          credentials: "include",
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || "Failed to share message")
        }

        const result = await res.json()
        toast.success(`Shared to #${result.channelSlug}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to share message")
      }
    },
    [workspaceId],
  )

  // Handler for cross-posting to another channel
  const handleCrosspostToChannel = useCallback(
    async (messageId: string, targetChannelId: string) => {
      try {
        const res = await fetch(`/api/workspace/${workspaceId}/messages/${messageId}/crosspost`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ targetChannelId }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || "Failed to cross-post message")
        }

        const result = await res.json()
        toast.success(`Cross-posted to #${result.channelSlug}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to cross-post message")
      }
    },
    [workspaceId],
  )

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

      <div className="flex-1 min-h-0 flex flex-col">
        {connectionError ? (
          <ConnectionError message={connectionError} />
        ) : (
          <MessageList
            messages={messages}
            workspaceId={workspaceId}
            channelId={channelId}
            conversationId={conversationId || undefined}
            lastReadMessageId={lastReadMessageId}
            isLoading={isLoading}
            isLoadingMore={isLoadingMore}
            hasMoreMessages={hasMoreMessages}
            isThread={isThread}
            hasRootMessage={Boolean(rootMessage)}
            currentUserId={currentUserId}
            highlightMessageId={highlightMessageId}
            onOpenThread={onOpenThread}
            onEditMessage={editMessage}
            onLoadMore={loadMoreMessages}
            onShareToChannel={handleShareToChannel}
            onCrosspostToChannel={handleCrosspostToChannel}
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
