import { api, API_BASE, ApiError, parseApiError } from "./client"
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
      throw await parseApiError(response, { code: "UPLOAD_ERROR", message: "Upload failed" })
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
  async getDownloadUrl(
    workspaceId: string,
    attachmentId: string,
    options?: { download?: boolean; variant?: "raw" | "processed" | "thumbnail" }
  ): Promise<string> {
    const key = `${workspaceId}:${attachmentId}:${options?.download ? "download" : "inline"}:${options?.variant ?? "raw"}`
    const cached = resolvedDownloadUrlCache.get(key)
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return cached.url
      }
      resolvedDownloadUrlCache.delete(key)
    }

    const existing = inFlightDownloadUrlRequests.get(key)
    if (existing) return existing

    const searchParams = new URLSearchParams()
    if (options?.download) searchParams.set("download", "true")
    if (options?.variant) searchParams.set("variant", options.variant)
    const params = searchParams.toString() ? `?${searchParams.toString()}` : ""
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
