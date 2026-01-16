import { Loader2, FileText, Image, File, AlertCircle, X } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { PendingAttachment } from "@/hooks/use-attachments"

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Image
  if (mimeType.startsWith("text/") || mimeType === "application/pdf") return FileText
  return File
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface PendingAttachmentsProps {
  attachments: PendingAttachment[]
  onRemove: (id: string) => void
}

export function PendingAttachments({ attachments, onRemove }: PendingAttachmentsProps) {
  if (attachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mb-3 max-h-[120px] overflow-y-auto">
      {attachments.map((attachment) => {
        const Icon = getFileIcon(attachment.mimeType)
        const isError = attachment.status === "error"
        const isUploading = attachment.status === "uploading"
        const isUploaded = attachment.status === "uploaded"

        const attachmentChip = (
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium",
              // Error state
              isError && "border border-destructive bg-destructive/10 text-destructive",
              // Uploading state - dashed border, muted (matches kitchen sink)
              isUploading && "border border-dashed border-muted-foreground/40 bg-transparent text-muted-foreground",
              // Uploaded state - gold accent (matches kitchen sink)
              isUploaded && "border border-primary/30 bg-primary/10 text-primary"
            )}
          >
            {attachment.status === "uploading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isError ? (
              <AlertCircle className="h-3.5 w-3.5" />
            ) : (
              <Icon className="h-3.5 w-3.5" />
            )}
            <span className="max-w-[120px] truncate">{attachment.filename}</span>
            {isError ? (
              <span>Failed</span>
            ) : (
              <span className={cn(isUploaded ? "text-primary/70" : "text-muted-foreground")}>
                {formatFileSize(attachment.sizeBytes)}
              </span>
            )}
            {attachment.status !== "uploading" && (
              <button
                type="button"
                onClick={() => onRemove(attachment.id)}
                className={cn(
                  "ml-0.5 rounded-full p-0.5 opacity-60 hover:opacity-100 transition-opacity",
                  isError && "hover:bg-destructive/20",
                  isUploaded && "hover:bg-primary/20"
                )}
                aria-label={`Remove ${attachment.filename}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )

        if (isError) {
          const isServerError =
            !attachment.error || attachment.error === "Internal server error" || attachment.error === "Upload failed"

          return (
            <Tooltip key={attachment.id}>
              <TooltipTrigger asChild>{attachmentChip}</TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="font-medium">Upload failed</p>
                {isServerError ? (
                  <p className="text-muted-foreground">We couldn't upload this file. Please remove it and try again.</p>
                ) : (
                  <p className="text-muted-foreground">{attachment.error}</p>
                )}
              </TooltipContent>
            </Tooltip>
          )
        }

        return <div key={attachment.id}>{attachmentChip}</div>
      })}
    </div>
  )
}
