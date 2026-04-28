import type { AttachmentSummary } from "@threa/types"
import type { Attachment } from "./repository"
import { isVideoAttachment } from "./video"

/**
 * Map a stored `Attachment` row to the lightweight `AttachmentSummary` wire
 * shape used in `message_created` event payloads and shared-message
 * hydration. The `processingStatus` carve-out for videos is the only
 * conditional bit — keeping it in one place avoids drift between the
 * timeline and shared-message paths (INV-37).
 */
export function toAttachmentSummary(a: Attachment): AttachmentSummary {
  return {
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    ...(isVideoAttachment(a.mimeType, a.filename) && { processingStatus: a.processingStatus }),
  }
}
