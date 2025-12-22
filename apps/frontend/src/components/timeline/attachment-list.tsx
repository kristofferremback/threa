import { useState, useCallback } from "react"
import { Download, FileText, Image, File, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { attachmentsApi } from "@/api"
import { cn } from "@/lib/utils"
import type { AttachmentSummary } from "@threa/types"

interface AttachmentListProps {
  attachments: AttachmentSummary[]
  workspaceId: string
  className?: string
}

interface AttachmentItemProps {
  attachment: AttachmentSummary
  workspaceId: string
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) {
    return Image
  }
  if (mimeType.startsWith("text/") || mimeType === "application/pdf") {
    return FileText
  }
  return File
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function AttachmentItem({ attachment, workspaceId }: AttachmentItemProps) {
  const [isDownloading, setIsDownloading] = useState(false)
  const Icon = getFileIcon(attachment.mimeType)

  const handleDownload = useCallback(async () => {
    setIsDownloading(true)
    try {
      const url = await attachmentsApi.getDownloadUrl(workspaceId, attachment.id)
      // Open in new tab for images/PDFs, download for other types
      const shouldPreview = attachment.mimeType.startsWith("image/") || attachment.mimeType === "application/pdf"

      if (shouldPreview) {
        window.open(url, "_blank")
      } else {
        // Force download using anchor element
        const link = document.createElement("a")
        link.href = url
        link.download = attachment.filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
    } catch (error) {
      console.error("Failed to download attachment:", error)
    } finally {
      setIsDownloading(false)
    }
  }, [workspaceId, attachment])

  return (
    <Button variant="outline" size="sm" className="h-8 gap-2 text-xs" onClick={handleDownload} disabled={isDownloading}>
      {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      <span className="max-w-[150px] truncate">{attachment.filename}</span>
      <span className="text-muted-foreground">{formatFileSize(attachment.sizeBytes)}</span>
      <Download className="h-3 w-3 opacity-50" />
    </Button>
  )
}

export function AttachmentList({ attachments, workspaceId, className }: AttachmentListProps) {
  if (!attachments || attachments.length === 0) {
    return null
  }

  return (
    <div className={cn("flex flex-wrap gap-2 mt-2", className)}>
      {attachments.map((attachment) => (
        <AttachmentItem key={attachment.id} attachment={attachment} workspaceId={workspaceId} />
      ))}
    </div>
  )
}
