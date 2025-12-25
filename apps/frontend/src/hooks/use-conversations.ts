import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useConversationService, useSocket } from "@/contexts"
import type { ConversationWithStaleness, ConversationStatus } from "@threa/types"

export const conversationKeys = {
  all: ["conversations"] as const,
  list: (workspaceId: string, streamId: string, options?: { status?: string; limit?: number }) =>
    [...conversationKeys.all, "list", workspaceId, streamId, options ?? {}] as const,
  byId: (workspaceId: string, conversationId: string) =>
    [...conversationKeys.all, "detail", workspaceId, conversationId] as const,
}

interface ConversationCreatedPayload {
  workspaceId: string
  streamId: string
  conversation: ConversationWithStaleness
  /** For thread conversations, the parent channel's stream ID */
  parentStreamId?: string
}

interface ConversationUpdatedPayload {
  workspaceId: string
  streamId: string
  conversationId: string
  conversation: ConversationWithStaleness
  /** For thread conversations, the parent channel's stream ID */
  parentStreamId?: string
}

interface UseConversationsOptions {
  status?: ConversationStatus
  limit?: number
  enabled?: boolean
}

export function useConversations(workspaceId: string, streamId: string, options?: UseConversationsOptions) {
  const { status, limit, enabled = true } = options ?? {}
  const conversationService = useConversationService()
  const queryClient = useQueryClient()
  const socket = useSocket()

  const {
    data: conversations = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: conversationKeys.list(workspaceId, streamId, { status, limit }),
    queryFn: () => conversationService.listByStream(workspaceId, streamId, { status, limit }),
    enabled: enabled && !!workspaceId && !!streamId,
  })

  // Handle real-time conversation events
  useEffect(() => {
    if (!socket || !workspaceId || !streamId || !enabled) return

    const handleCreated = (payload: ConversationCreatedPayload) => {
      // Accept events for this stream OR thread conversations whose parent is this stream
      if (payload.streamId !== streamId && payload.parentStreamId !== streamId) return

      queryClient.setQueryData(
        conversationKeys.list(workspaceId, streamId, { status, limit }),
        (old: ConversationWithStaleness[] | undefined) => {
          if (!old) return [payload.conversation]
          if (old.some((c) => c.id === payload.conversation.id)) return old
          return [...old, payload.conversation]
        }
      )
    }

    const handleUpdated = (payload: ConversationUpdatedPayload) => {
      // Accept events for this stream OR thread conversations whose parent is this stream
      if (payload.streamId !== streamId && payload.parentStreamId !== streamId) return

      queryClient.setQueryData(
        conversationKeys.list(workspaceId, streamId, { status, limit }),
        (old: ConversationWithStaleness[] | undefined) => {
          if (!old) return old
          // For thread conversations viewed from parent channel, add if not present
          const exists = old.some((c) => c.id === payload.conversationId)
          if (!exists) {
            return [...old, payload.conversation]
          }
          return old.map((c) => (c.id === payload.conversationId ? payload.conversation : c))
        }
      )
    }

    socket.on("conversation:created", handleCreated)
    socket.on("conversation:updated", handleUpdated)

    return () => {
      socket.off("conversation:created", handleCreated)
      socket.off("conversation:updated", handleUpdated)
    }
  }, [socket, workspaceId, streamId, status, limit, enabled, queryClient])

  return {
    conversations,
    isLoading,
    error,
    refetch,
  }
}
