import { api, ApiError } from "./client"
import type { Attachment } from "@threa/types"

export const attachmentsApi = {
  /**
   * Upload a file to a stream.
   * Uses multipart form data instead of JSON.
   */
  async upload(workspaceId: string, streamId: string, file: File): Promise<Attachment> {
    const formData = new FormData()
    formData.append("file", file)

    const response = await fetch(`/api/workspaces/${workspaceId}/streams/${streamId}/attachments`, {
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
  async getDownloadUrl(workspaceId: string, attachmentId: string): Promise<string> {
    const res = await api.get<{ url: string; expiresIn: number }>(
      `/api/workspaces/${workspaceId}/attachments/${attachmentId}/url`
    )
    return res.url
  },

  /**
   * Delete an unattached file.
   * Attached files cannot be deleted.
   */
  delete(workspaceId: string, attachmentId: string): Promise<void> {
    return api.delete(`/api/workspaces/${workspaceId}/attachments/${attachmentId}`)
  },
}
