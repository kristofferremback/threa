import { api } from "./client"
import type { ConversationWithStaleness, ConversationStatus } from "@threa/types"

export interface ListConversationsParams {
  status?: ConversationStatus
  limit?: number
}

export const conversationsApi = {
  async listByStream(
    workspaceId: string,
    streamId: string,
    params?: ListConversationsParams
  ): Promise<ConversationWithStaleness[]> {
    const searchParams = new URLSearchParams()
    if (params?.status) searchParams.set("status", params.status)
    if (params?.limit) searchParams.set("limit", params.limit.toString())
    const query = searchParams.toString()
    const res = await api.get<{ conversations: ConversationWithStaleness[] }>(
      `/api/workspaces/${workspaceId}/streams/${streamId}/conversations${query ? `?${query}` : ""}`
    )
    return res.conversations
  },

  async getById(workspaceId: string, conversationId: string): Promise<ConversationWithStaleness> {
    const res = await api.get<{ conversation: ConversationWithStaleness }>(
      `/api/workspaces/${workspaceId}/conversations/${conversationId}`
    )
    return res.conversation
  },
}
