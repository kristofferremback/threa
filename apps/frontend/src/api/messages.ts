import { api } from "./client"
import type { Message, CreateMessageInput, CreateDmMessageInput, UpdateMessageInput } from "@threa/types"

export type { CreateMessageInput, CreateDmMessageInput, UpdateMessageInput }

export const messagesApi = {
  async create(workspaceId: string, streamId: string, data: CreateMessageInput): Promise<Message> {
    const res = await api.post<{ message: Message }>(`/api/workspaces/${workspaceId}/messages`, {
      ...data,
      streamId,
    })
    return res.message
  },

  async createDm(workspaceId: string, dmMemberId: string, data: CreateDmMessageInput): Promise<Message> {
    const res = await api.post<{ message: Message }>(`/api/workspaces/${workspaceId}/messages`, {
      ...data,
      dmMemberId,
    })
    return res.message
  },

  async update(workspaceId: string, messageId: string, data: UpdateMessageInput): Promise<Message> {
    const res = await api.patch<{ message: Message }>(`/api/workspaces/${workspaceId}/messages/${messageId}`, data)
    return res.message
  },

  delete(workspaceId: string, messageId: string): Promise<void> {
    return api.delete(`/api/workspaces/${workspaceId}/messages/${messageId}`)
  },

  // Reactions
  addReaction(workspaceId: string, messageId: string, emoji: string): Promise<void> {
    return api.post(`/api/workspaces/${workspaceId}/messages/${messageId}/reactions`, { emoji })
  },

  removeReaction(workspaceId: string, messageId: string, emoji: string): Promise<void> {
    return api.delete(`/api/workspaces/${workspaceId}/messages/${messageId}/reactions/${emoji}`)
  },
}
