import { api } from "./client"
import type {
  ScheduledMessageView,
  ScheduledMessageListResponse,
  ScheduledMessageStatus,
  ScheduleMessageInput,
  UpdateScheduledMessageInput,
  ClaimScheduledMessageResponse,
} from "@threa/types"

export interface ListScheduledParams {
  status: ScheduledMessageStatus
  streamId?: string
  limit?: number
  cursor?: string
}

export const scheduledApi = {
  async list(workspaceId: string, params: ListScheduledParams): Promise<ScheduledMessageListResponse> {
    const query = new URLSearchParams()
    query.set("status", params.status)
    if (params.streamId) query.set("streamId", params.streamId)
    if (params.limit) query.set("limit", String(params.limit))
    if (params.cursor) query.set("cursor", params.cursor)

    return api.get<ScheduledMessageListResponse>(`/api/workspaces/${workspaceId}/scheduled?${query.toString()}`)
  },

  async getById(workspaceId: string, id: string): Promise<ScheduledMessageView> {
    const res = await api.get<{ scheduled: ScheduledMessageView }>(`/api/workspaces/${workspaceId}/scheduled/${id}`)
    return res.scheduled
  },

  async create(workspaceId: string, input: ScheduleMessageInput): Promise<ScheduledMessageView> {
    const res = await api.post<{ scheduled: ScheduledMessageView }>(`/api/workspaces/${workspaceId}/scheduled`, input)
    return res.scheduled
  },

  async update(workspaceId: string, id: string, input: UpdateScheduledMessageInput): Promise<ScheduledMessageView> {
    const res = await api.patch<{ scheduled: ScheduledMessageView }>(
      `/api/workspaces/${workspaceId}/scheduled/${id}`,
      input
    )
    return res.scheduled
  },

  async delete(workspaceId: string, id: string): Promise<void> {
    await api.delete<{ ok: true }>(`/api/workspaces/${workspaceId}/scheduled/${id}`)
  },

  async claim(workspaceId: string, id: string): Promise<ClaimScheduledMessageResponse> {
    return api.post<ClaimScheduledMessageResponse>(`/api/workspaces/${workspaceId}/scheduled/${id}/claim`, {})
  },

  async heartbeat(workspaceId: string, id: string, lockToken: string): Promise<{ lockExpiresAt: string }> {
    return api.post<{ lockExpiresAt: string }>(`/api/workspaces/${workspaceId}/scheduled/${id}/heartbeat`, {
      lockToken,
    })
  },

  async release(workspaceId: string, id: string, lockToken: string): Promise<void> {
    await api.post<{ ok: true }>(`/api/workspaces/${workspaceId}/scheduled/${id}/release`, { lockToken })
  },

  async sendNow(workspaceId: string, id: string): Promise<ScheduledMessageView> {
    const res = await api.post<{ scheduled: ScheduledMessageView }>(
      `/api/workspaces/${workspaceId}/scheduled/${id}/send-now`,
      {}
    )
    return res.scheduled
  },
}
