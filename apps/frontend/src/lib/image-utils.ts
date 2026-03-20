import { toast } from "sonner"
import { attachmentsApi } from "@/api"

/**
 * Downloads an image by requesting a presigned URL with Content-Disposition: attachment.
 * This avoids cross-origin fetch — the browser navigates directly to the S3 URL which
 * triggers a download thanks to the Content-Disposition header.
 */
export async function downloadImage(workspaceId: string, attachmentId: string, filename: string): Promise<void> {
  try {
    const url = await attachmentsApi.getDownloadUrl(workspaceId, attachmentId, { download: true })
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success("Image downloaded")
  } catch {
    toast.error("Failed to download image")
  }
}

/**
 * Copies an image to clipboard by fetching its blob data.
 * Requires S3 CORS to be configured for cross-origin fetch access.
 */
export async function copyImage(url: string): Promise<void> {
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob()

    // Safari requires the ClipboardItem to be constructed with a Promise
    const type = blob.type || "image/png"
    await navigator.clipboard.write([new ClipboardItem({ [type]: blob })])
    toast.success("Image copied")
  } catch {
    toast.error("Failed to copy image")
  }
}
