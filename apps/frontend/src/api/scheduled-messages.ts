import { api } from "./client"
import type {
  CreateScheduledMessageInput,
  ScheduledMessageListResponse,
  ScheduledMessageVersionInput,
  ScheduledMessageView,
  UpdateScheduledMessageInput,
} from "@threa/types"

export const scheduledMessagesApi = {
  list(workspaceId: string): Promise<ScheduledMessageListResponse> {
    return api.get(`/api/workspaces/${workspaceId}/scheduled-messages`)
  },

  async create(workspaceId: string, input: CreateScheduledMessageInput): Promise<ScheduledMessageView> {
    const res = await api.post<{ scheduled: ScheduledMessageView }>(
      `/api/workspaces/${workspaceId}/scheduled-messages`,
      input
    )
    return res.scheduled
  },

  async update(
    workspaceId: string,
    scheduledId: string,
    input: UpdateScheduledMessageInput
  ): Promise<ScheduledMessageView> {
    const res = await api.patch<{ scheduled: ScheduledMessageView }>(
      `/api/workspaces/${workspaceId}/scheduled-messages/${scheduledId}`,
      input
    )
    return res.scheduled
  },

  async pause(
    workspaceId: string,
    scheduledId: string,
    input: ScheduledMessageVersionInput = {}
  ): Promise<ScheduledMessageView> {
    const res = await api.post<{ scheduled: ScheduledMessageView }>(
      `/api/workspaces/${workspaceId}/scheduled-messages/${scheduledId}/pause`,
      input
    )
    return res.scheduled
  },

  async resume(
    workspaceId: string,
    scheduledId: string,
    input: ScheduledMessageVersionInput = {}
  ): Promise<ScheduledMessageView> {
    const res = await api.post<{ scheduled: ScheduledMessageView }>(
      `/api/workspaces/${workspaceId}/scheduled-messages/${scheduledId}/resume`,
      input
    )
    return res.scheduled
  },

  async sendNow(
    workspaceId: string,
    scheduledId: string,
    input: ScheduledMessageVersionInput = {}
  ): Promise<ScheduledMessageView> {
    const res = await api.post<{ scheduled: ScheduledMessageView }>(
      `/api/workspaces/${workspaceId}/scheduled-messages/${scheduledId}/send-now`,
      input
    )
    return res.scheduled
  },

  async editLock(
    workspaceId: string,
    scheduledId: string,
    input: ScheduledMessageVersionInput = {}
  ): Promise<ScheduledMessageView> {
    const res = await api.post<{ scheduled: ScheduledMessageView }>(
      `/api/workspaces/${workspaceId}/scheduled-messages/${scheduledId}/edit-lock`,
      input
    )
    return res.scheduled
  },

  delete(workspaceId: string, scheduledId: string, input: ScheduledMessageVersionInput = {}): Promise<void> {
    return api.delete(`/api/workspaces/${workspaceId}/scheduled-messages/${scheduledId}`, {
      body: JSON.stringify(input),
    })
  },
}
