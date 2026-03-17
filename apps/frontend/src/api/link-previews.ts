import { api } from "./client"
import type { LinkPreviewSummary } from "@threa/types"

export interface LinkPreviewWithDismissed extends LinkPreviewSummary {
  dismissed: boolean
}

export const linkPreviewsApi = {
  async getForMessage(workspaceId: string, messageId: string): Promise<LinkPreviewWithDismissed[]> {
    const res = await api.get<{ previews: LinkPreviewWithDismissed[] }>(
      `/api/workspaces/${workspaceId}/messages/${messageId}/link-previews`
    )
    return res.previews
  },

  async dismiss(workspaceId: string, linkPreviewId: string, messageId: string): Promise<void> {
    await api.post(`/api/workspaces/${workspaceId}/link-previews/${linkPreviewId}/dismiss`, { messageId })
  },

  async undismiss(workspaceId: string, linkPreviewId: string): Promise<void> {
    await api.delete(`/api/workspaces/${workspaceId}/link-previews/${linkPreviewId}/dismiss`)
  },
}
