import { api } from "./client"
import type {
  Stream,
  StreamEvent,
  StreamMember,
  StreamType,
  StreamBootstrap,
  CreateStreamInput,
  UpdateStreamInput,
  NotificationLevel,
} from "@threa/types"

export type { StreamBootstrap, CreateStreamInput, UpdateStreamInput }

export type StreamArchiveStatus = "active" | "archived"

export const streamsApi = {
  async list(workspaceId: string, params?: { type?: StreamType; status?: StreamArchiveStatus[] }): Promise<Stream[]> {
    const searchParams = new URLSearchParams()
    if (params?.type) searchParams.set("stream_type", params.type)
    if (params?.status) {
      params.status.forEach((s) => searchParams.append("status", s))
    }
    const query = searchParams.toString()
    const res = await api.get<{ streams: Stream[] }>(
      `/api/workspaces/${workspaceId}/streams${query ? `?${query}` : ""}`
    )
    return res.streams
  },

  async get(workspaceId: string, streamId: string): Promise<Stream> {
    const res = await api.get<{ stream: Stream }>(`/api/workspaces/${workspaceId}/streams/${streamId}`)
    return res.stream
  },

  async bootstrap(workspaceId: string, streamId: string): Promise<StreamBootstrap> {
    const res = await api.get<{ data: StreamBootstrap }>(`/api/workspaces/${workspaceId}/streams/${streamId}/bootstrap`)
    return res.data
  },

  async create(workspaceId: string, data: CreateStreamInput): Promise<Stream> {
    const res = await api.post<{ stream: Stream }>(`/api/workspaces/${workspaceId}/streams`, data)
    return res.stream
  },

  async update(workspaceId: string, streamId: string, data: UpdateStreamInput): Promise<Stream> {
    const res = await api.patch<{ stream: Stream }>(`/api/workspaces/${workspaceId}/streams/${streamId}`, data)
    return res.stream
  },

  archive(workspaceId: string, streamId: string): Promise<void> {
    return api.post(`/api/workspaces/${workspaceId}/streams/${streamId}/archive`)
  },

  unarchive(workspaceId: string, streamId: string): Promise<void> {
    return api.post(`/api/workspaces/${workspaceId}/streams/${streamId}/unarchive`)
  },

  // Event fetching for pagination
  async getEvents(
    workspaceId: string,
    streamId: string,
    params?: { before?: string; limit?: number }
  ): Promise<StreamEvent[]> {
    const searchParams = new URLSearchParams()
    if (params?.before) searchParams.set("after", params.before)
    if (params?.limit) searchParams.set("limit", params.limit.toString())
    const query = searchParams.toString()
    const res = await api.get<{ events: StreamEvent[] }>(
      `/api/workspaces/${workspaceId}/streams/${streamId}/events${query ? `?${query}` : ""}`
    )
    return res.events
  },

  async checkSlugAvailable(workspaceId: string, slug: string, excludeStreamId?: string): Promise<boolean> {
    const params = new URLSearchParams({ slug })
    if (excludeStreamId) params.set("exclude", excludeStreamId)
    const res = await api.get<{ available: boolean }>(
      `/api/workspaces/${workspaceId}/streams/slug-available?${params.toString()}`
    )
    return res.available
  },

  async addMember(workspaceId: string, streamId: string, memberId: string): Promise<StreamMember> {
    const res = await api.post<{ membership: StreamMember }>(
      `/api/workspaces/${workspaceId}/streams/${streamId}/members`,
      { memberId }
    )
    return res.membership
  },

  async removeMember(workspaceId: string, streamId: string, memberId: string): Promise<void> {
    await api.delete(`/api/workspaces/${workspaceId}/streams/${streamId}/members/${memberId}`)
  },

  async setNotificationLevel(
    workspaceId: string,
    streamId: string,
    notificationLevel: NotificationLevel | null
  ): Promise<StreamMember> {
    const res = await api.post<{ membership: StreamMember }>(
      `/api/workspaces/${workspaceId}/streams/${streamId}/notification-level`,
      { notificationLevel }
    )
    return res.membership
  },

  async join(workspaceId: string, streamId: string): Promise<StreamMember> {
    const res = await api.post<{ data: { membership: StreamMember } }>(
      `/api/workspaces/${workspaceId}/streams/${streamId}/join`
    )
    return res.data.membership
  },

  async markAsRead(workspaceId: string, streamId: string, lastEventId: string): Promise<StreamMember> {
    const res = await api.post<{ membership: StreamMember }>(
      `/api/workspaces/${workspaceId}/streams/${streamId}/read`,
      { lastEventId }
    )
    return res.membership
  },
}
