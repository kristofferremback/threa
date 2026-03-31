import { api } from "./client"
import type { LinkPreviewSummary, MessageLinkPreviewData } from "@threa/types"

export interface LinkPreviewWithDismissed extends LinkPreviewSummary {
  dismissed: boolean
}

const inFlightMessagePreviewRequests = new Map<string, Promise<LinkPreviewWithDismissed[]>>()
const inFlightResolvedMessageLinkRequests = new Map<string, Promise<MessageLinkPreviewData>>()

export const linkPreviewsApi = {
  async getForMessage(workspaceId: string, messageId: string): Promise<LinkPreviewWithDismissed[]> {
    const key = `${workspaceId}:${messageId}`
    const existing = inFlightMessagePreviewRequests.get(key)
    if (existing) return existing

    const request = api
      .get<{ previews: LinkPreviewWithDismissed[] }>(
        `/api/workspaces/${workspaceId}/messages/${messageId}/link-previews`
      )
      .then((res) => res.previews)
      .finally(() => {
        inFlightMessagePreviewRequests.delete(key)
      })

    inFlightMessagePreviewRequests.set(key, request)
    return request
  },

  async dismiss(workspaceId: string, messageId: string, linkPreviewId: string): Promise<void> {
    await api.post(`/api/workspaces/${workspaceId}/messages/${messageId}/link-previews/${linkPreviewId}/dismiss`)
    inFlightMessagePreviewRequests.delete(`${workspaceId}:${messageId}`)
    inFlightResolvedMessageLinkRequests.delete(`${workspaceId}:${linkPreviewId}`)
  },

  async resolveMessageLink(workspaceId: string, linkPreviewId: string): Promise<MessageLinkPreviewData> {
    const key = `${workspaceId}:${linkPreviewId}`
    const existing = inFlightResolvedMessageLinkRequests.get(key)
    if (existing) return existing

    const request = api
      .get<MessageLinkPreviewData>(`/api/workspaces/${workspaceId}/link-previews/${linkPreviewId}/resolve`)
      .finally(() => {
        inFlightResolvedMessageLinkRequests.delete(key)
      })

    inFlightResolvedMessageLinkRequests.set(key, request)
    return request
  },
}
