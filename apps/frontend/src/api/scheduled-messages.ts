import { api } from "./client"
import type {
  ScheduledMessageView,
  ScheduledMessageListResponse,
  ScheduleMessageInput,
  UpdateScheduledMessageInput,
} from "@threa/types"

export const scheduledMessagesApi = {
  async schedule(
    workspaceId: string,
    input: ScheduleMessageInput
  ): Promise<{ scheduled: ScheduledMessageView; sentNow: boolean }> {
    return api.post<{ scheduled: ScheduledMessageView; sentNow: boolean }>(
      `/api/workspaces/${workspaceId}/scheduled-messages`,
      input
    )
  },

  async list(workspaceId: string, streamId?: string): Promise<ScheduledMessageListResponse> {
    const query = streamId ? `?streamId=${encodeURIComponent(streamId)}` : ""
    return api.get<ScheduledMessageListResponse>(`/api/workspaces/${workspaceId}/scheduled-messages${query}`)
  },

  async update(
    workspaceId: string,
    id: string,
    input: UpdateScheduledMessageInput
  ): Promise<{ scheduled: ScheduledMessageView }> {
    return api.patch<{ scheduled: ScheduledMessageView }>(
      `/api/workspaces/${workspaceId}/scheduled-messages/${id}`,
      input
    )
  },

  async cancel(workspaceId: string, id: string): Promise<void> {
    await api.delete<{ ok: true }>(`/api/workspaces/${workspaceId}/scheduled-messages/${id}`)
  },

  async sendNow(workspaceId: string, id: string): Promise<{ scheduled: ScheduledMessageView }> {
    return api.patch<{ scheduled: ScheduledMessageView }>(`/api/workspaces/${workspaceId}/scheduled-messages/${id}`, {
      scheduledAt: new Date().toISOString(),
    })
  },

  async pause(workspaceId: string, id: string): Promise<{ scheduled: ScheduledMessageView }> {
    return api.post<{ scheduled: ScheduledMessageView }>(
      `/api/workspaces/${workspaceId}/scheduled-messages/${id}/pause`
    )
  },

  async resume(workspaceId: string, id: string): Promise<{ scheduled: ScheduledMessageView }> {
    return api.post<{ scheduled: ScheduledMessageView }>(
      `/api/workspaces/${workspaceId}/scheduled-messages/${id}/resume`
    )
  },
}
