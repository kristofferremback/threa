import { api } from "./client"
import type { Bot, BotApiKey, CreateBotApiKeyResponse } from "@threa/types"

export interface CreateBotInput {
  name: string
  slug: string
  description?: string | null
  avatarEmoji?: string | null
}

export interface UpdateBotInput {
  name?: string
  slug?: string
  description?: string | null
  avatarEmoji?: string | null
}

export interface CreateBotKeyInput {
  name: string
  scopes: string[]
  expiresAt?: string | null
}

export const botsApi = {
  async list(workspaceId: string): Promise<Bot[]> {
    const res = await api.get<{ data: Bot[] }>(`/api/workspaces/${workspaceId}/bots`)
    return res.data
  },

  async get(workspaceId: string, botId: string): Promise<Bot> {
    const res = await api.get<{ data: Bot }>(`/api/workspaces/${workspaceId}/bots/${botId}`)
    return res.data
  },

  async create(workspaceId: string, data: CreateBotInput): Promise<Bot> {
    const res = await api.post<{ data: Bot }>(`/api/workspaces/${workspaceId}/bots`, data)
    return res.data
  },

  async update(workspaceId: string, botId: string, data: UpdateBotInput): Promise<Bot> {
    const res = await api.patch<{ data: Bot }>(`/api/workspaces/${workspaceId}/bots/${botId}`, data)
    return res.data
  },

  async archive(workspaceId: string, botId: string): Promise<Bot> {
    const res = await api.post<{ data: Bot }>(`/api/workspaces/${workspaceId}/bots/${botId}/archive`)
    return res.data
  },

  async restore(workspaceId: string, botId: string): Promise<Bot> {
    const res = await api.post<{ data: Bot }>(`/api/workspaces/${workspaceId}/bots/${botId}/restore`)
    return res.data
  },

  // Key management

  async listKeys(workspaceId: string, botId: string): Promise<BotApiKey[]> {
    const res = await api.get<{ data: BotApiKey[] }>(`/api/workspaces/${workspaceId}/bots/${botId}/keys`)
    return res.data
  },

  async createKey(workspaceId: string, botId: string, data: CreateBotKeyInput): Promise<CreateBotApiKeyResponse> {
    return api.post<CreateBotApiKeyResponse>(`/api/workspaces/${workspaceId}/bots/${botId}/keys`, data)
  },

  async revokeKey(workspaceId: string, botId: string, keyId: string): Promise<void> {
    await api.post(`/api/workspaces/${workspaceId}/bots/${botId}/keys/${keyId}/revoke`)
  },
}
