import { useEffect, useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useConversationService, useSocket } from "@/contexts"
import type { ConversationWithStaleness, ConversationStatus } from "@threa/types"

export const conversationKeys = {
  all: ["conversations"] as const,
  list: (workspaceId: string, streamId: string) => [...conversationKeys.all, "list", workspaceId, streamId] as const,
  byId: (workspaceId: string, conversationId: string) =>
    [...conversationKeys.all, "detail", workspaceId, conversationId] as const,
}

interface ConversationCreatedPayload {
  workspaceId: string
  streamId: string
  conversation: ConversationWithStaleness
}

interface ConversationUpdatedPayload {
  workspaceId: string
  streamId: string
  conversationId: string
  conversation: ConversationWithStaleness
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
    queryKey: conversationKeys.list(workspaceId, streamId),
    queryFn: () => conversationService.listByStream(workspaceId, streamId, { status, limit }),
    enabled: enabled && !!workspaceId && !!streamId,
  })

  // Handle real-time conversation events
  useEffect(() => {
    if (!socket || !workspaceId || !streamId || !enabled) return

    const handleCreated = (payload: ConversationCreatedPayload) => {
      if (payload.streamId !== streamId) return

      queryClient.setQueryData(
        conversationKeys.list(workspaceId, streamId),
        (old: ConversationWithStaleness[] | undefined) => {
          if (!old) return [payload.conversation]
          if (old.some((c) => c.id === payload.conversation.id)) return old
          return [...old, payload.conversation]
        }
      )
    }

    const handleUpdated = (payload: ConversationUpdatedPayload) => {
      if (payload.streamId !== streamId) return

      queryClient.setQueryData(
        conversationKeys.list(workspaceId, streamId),
        (old: ConversationWithStaleness[] | undefined) => {
          if (!old) return old
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
  }, [socket, workspaceId, streamId, enabled, queryClient])

  const addConversation = useCallback(
    (conversation: ConversationWithStaleness) => {
      queryClient.setQueryData(
        conversationKeys.list(workspaceId, streamId),
        (old: ConversationWithStaleness[] | undefined) => {
          if (!old) return [conversation]
          if (old.some((c) => c.id === conversation.id)) return old
          return [...old, conversation]
        }
      )
    },
    [queryClient, workspaceId, streamId]
  )

  const updateConversation = useCallback(
    (conversationId: string, changes: Partial<ConversationWithStaleness>) => {
      queryClient.setQueryData(
        conversationKeys.list(workspaceId, streamId),
        (old: ConversationWithStaleness[] | undefined) => {
          if (!old) return old
          return old.map((c) => (c.id === conversationId ? { ...c, ...changes } : c))
        }
      )
    },
    [queryClient, workspaceId, streamId]
  )

  return {
    conversations,
    isLoading,
    error,
    refetch,
    addConversation,
    updateConversation,
  }
}
