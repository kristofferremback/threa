import type { ReactNode } from "react"
import { Loader2, FileText, Image as ImageIcon, File as FileIcon, AlertCircle } from "lucide-react"
import { AttachmentPill, type AttachmentPillStatus } from "@/components/composer/attachment-pill"
import type { PendingAttachment } from "@/hooks/use-attachments"

function getFileIcon(mimeType: string): typeof FileIcon {
  if (mimeType.startsWith("image/")) return ImageIcon
  if (mimeType.startsWith("text/") || mimeType === "application/pdf") return FileText
  return FileIcon
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const STATUS_MAP: Record<PendingAttachment["status"], AttachmentPillStatus> = {
  uploading: "pending",
  uploaded: "default",
  error: "error",
}

interface PendingAttachmentsProps {
  attachments: PendingAttachment[]
  onRemove: (id: string) => void
  /**
   * Pills rendered inside the same flex-wrap row before the file pills.
   * Used by the composer to fold context-ref chips into the same visual
   * surface as file uploads — so users see one row of "things attached
   * to this message," not two stacked rows.
   */
  beforePills?: ReactNode
}

/**
 * Composer attachment row: renders pending file uploads alongside any
 * caller-provided `beforePills` (typically context-ref chips) inside a
 * single `flex flex-wrap` container. Uses the shared `<AttachmentPill>`
 * primitive so files + context-refs share visuals (rounded-lg border,
 * primary accent, dashed-border pending state).
 *
 * Renders nothing when both lists are empty.
 */
export function PendingAttachments({ attachments, onRemove, beforePills }: PendingAttachmentsProps) {
  if (attachments.length === 0 && !beforePills) return null

  return (
    <div className="flex flex-wrap gap-2 mb-3 max-h-[120px] overflow-y-auto">
      {beforePills}
      {attachments.map((attachment) => {
        const status = STATUS_MAP[attachment.status]
        const isUploading = attachment.status === "uploading"
        const isError = attachment.status === "error"
        let Icon = getFileIcon(attachment.mimeType)
        if (isUploading) Icon = Loader2
        else if (isError) Icon = AlertCircle

        const isGenericError =
          isError &&
          (attachment.error === "Internal server error" || attachment.error === "Upload failed" || !attachment.error)
        let tooltip: string | undefined
        if (isGenericError) tooltip = "We couldn't upload this file. Please remove it and try again."
        else if (isError) tooltip = attachment.error

        return (
          <AttachmentPill
            key={attachment.id}
            icon={Icon}
            label={attachment.filename}
            secondary={isError ? "Failed" : formatFileSize(attachment.sizeBytes)}
            status={status}
            tooltip={tooltip}
            onRemove={isUploading ? undefined : () => onRemove(attachment.id)}
            removeLabel={`Remove ${attachment.filename}`}
            labelMaxWidth="max-w-[120px]"
          />
        )
      })}
    </div>
  )
}
