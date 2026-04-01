import { api, API_BASE, ApiError } from "./client"
import type { Attachment } from "@threa/types"

const inFlightDownloadUrlRequests = new Map<string, Promise<string>>()
const resolvedDownloadUrlCache = new Map<string, { url: string; expiresAt: number }>()

export function resetAttachmentUrlCache(): void {
  inFlightDownloadUrlRequests.clear()
  resolvedDownloadUrlCache.clear()
}

export const attachmentsApi = {
  /**
   * Upload a file to the workspace.
   * File is uploaded to workspace-level; streamId is set when attached to a message.
   * Uses multipart form data instead of JSON.
   */
  async upload(workspaceId: string, file: File): Promise<Attachment> {
    const formData = new FormData()
    formData.append("file", file)

    const response = await fetch(`${API_BASE}/api/workspaces/${workspaceId}/attachments`, {
      method: "POST",
      body: formData,
      credentials: "include",
      // Note: Don't set Content-Type header - browser sets it with boundary
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const errorMessage = typeof body.error === "string" ? body.error : body.error?.message || "Upload failed"
      throw new ApiError(response.status, body.error?.code || "UPLOAD_ERROR", errorMessage, body.error?.details)
    }

    const body = await response.json()
    if (!body.attachment) {
      throw new ApiError(500, "INVALID_RESPONSE", "Server returned invalid response")
    }
    return body.attachment
  },

  /**
   * Get a presigned download URL for an attachment.
   * URL is valid for 15 minutes.
   */
  async getDownloadUrl(workspaceId: string, attachmentId: string, options?: { download?: boolean }): Promise<string> {
    const key = `${workspaceId}:${attachmentId}:${options?.download ? "download" : "inline"}`
    const cached = resolvedDownloadUrlCache.get(key)
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return cached.url
      }
      resolvedDownloadUrlCache.delete(key)
    }

    const existing = inFlightDownloadUrlRequests.get(key)
    if (existing) return existing

    const params = options?.download ? "?download=true" : ""
    const request = api
      .get<{ url: string; expiresIn: number }>(
        `/api/workspaces/${workspaceId}/attachments/${attachmentId}/url${params}`
      )
      .then((res) => {
        resolvedDownloadUrlCache.set(key, {
          url: res.url,
          expiresAt: Date.now() + Math.max(0, res.expiresIn * 1000 - 5_000),
        })
        return res.url
      })
      .finally(() => {
        inFlightDownloadUrlRequests.delete(key)
      })

    inFlightDownloadUrlRequests.set(key, request)
    return request
  },

  /**
   * Delete an unattached file.
   * Attached files cannot be deleted.
   */
  delete(workspaceId: string, attachmentId: string): Promise<void> {
    return api.delete(`/api/workspaces/${workspaceId}/attachments/${attachmentId}`)
  },
}
