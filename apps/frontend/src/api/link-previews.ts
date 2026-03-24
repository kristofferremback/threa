import { api } from "./client"
import type { LinkPreviewSummary, MessageLinkPreviewData } from "@threa/types"

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

  async dismiss(workspaceId: string, messageId: string, linkPreviewId: string): Promise<void> {
    await api.post(`/api/workspaces/${workspaceId}/messages/${messageId}/link-previews/${linkPreviewId}/dismiss`)
  },

  async resolveMessageLink(workspaceId: string, linkPreviewId: string): Promise<MessageLinkPreviewData> {
    return api.get<MessageLinkPreviewData>(`/api/workspaces/${workspaceId}/link-previews/${linkPreviewId}/resolve`)
  },
}
