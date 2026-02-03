import { useState, useCallback, useEffect } from "react"
import { Download, FileText, File, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ImageLightbox } from "@/components/image-lightbox"
import { attachmentsApi } from "@/api"
import { cn } from "@/lib/utils"
import { useAttachmentContext } from "@/lib/markdown/attachment-context"
import type { AttachmentSummary } from "@threa/types"

interface AttachmentListProps {
  attachments: AttachmentSummary[]
  workspaceId: string
  className?: string
}

interface AttachmentItemProps {
  attachment: AttachmentSummary
  workspaceId: string
  onImageClick?: (url: string, filename: string) => void
  isHighlighted?: boolean
}

function getFileIcon(mimeType: string) {
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

function ImageAttachment({ attachment, workspaceId, onImageClick, isHighlighted }: AttachmentItemProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let mounted = true

    async function loadImage() {
      try {
        const url = await attachmentsApi.getDownloadUrl(workspaceId, attachment.id)
        if (mounted) {
          setImageUrl(url)
        }
      } catch {
        if (mounted) {
          setError(true)
        }
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    loadImage()

    return () => {
      mounted = false
    }
  }, [workspaceId, attachment.id])

  const handleClick = useCallback(() => {
    if (imageUrl && onImageClick) {
      onImageClick(imageUrl, attachment.filename)
    }
  }, [imageUrl, onImageClick, attachment.filename])

  if (error) {
    return <div className="rounded-lg border bg-muted/50 p-2 text-xs text-muted-foreground">Failed to load image</div>
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isLoading || !imageUrl}
      data-highlighted={isHighlighted || undefined}
      className={cn(
        "relative overflow-hidden rounded-lg border bg-muted/30 transition-all",
        "hover:border-primary hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        "disabled:cursor-wait",
        isHighlighted && "ring-2 ring-primary border-primary shadow-sm"
      )}
    >
      {isLoading ? (
        <div className="flex h-32 w-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <img src={imageUrl!} alt={attachment.filename} className="h-32 w-auto max-w-xs object-cover" loading="lazy" />
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
        <span className="block truncate text-xs text-white">{attachment.filename}</span>
      </div>
    </button>
  )
}

function FileAttachment({ attachment, workspaceId, isHighlighted }: AttachmentItemProps) {
  const [isDownloading, setIsDownloading] = useState(false)
  const Icon = getFileIcon(attachment.mimeType)

  const handleDownload = useCallback(async () => {
    setIsDownloading(true)
    try {
      const url = await attachmentsApi.getDownloadUrl(workspaceId, attachment.id)
      // Open in new tab for PDFs, download for other types
      if (attachment.mimeType === "application/pdf") {
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
    <Button
      variant="outline"
      size="sm"
      className={cn("h-8 gap-2 text-xs", isHighlighted && "ring-2 ring-primary border-primary shadow-sm")}
      onClick={handleDownload}
      disabled={isDownloading}
    >
      {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      <span className="max-w-[150px] truncate">{attachment.filename}</span>
      <span className="text-muted-foreground">{formatFileSize(attachment.sizeBytes)}</span>
      <Download className="h-3 w-3 opacity-50" />
    </Button>
  )
}

export function AttachmentList({ attachments, workspaceId, className }: AttachmentListProps) {
  const [lightbox, setLightbox] = useState<{ url: string; filename: string } | null>(null)
  const attachmentContext = useAttachmentContext()
  const hoveredAttachmentId = attachmentContext?.hoveredAttachmentId ?? null

  if (!attachments || attachments.length === 0) {
    return null
  }

  const imageAttachments = attachments.filter((a) => a.mimeType.startsWith("image/"))
  const fileAttachments = attachments.filter((a) => !a.mimeType.startsWith("image/"))

  const handleImageClick = useCallback((url: string, filename: string) => {
    setLightbox({ url, filename })
  }, [])

  const handleLightboxClose = useCallback(() => {
    setLightbox(null)
  }, [])

  return (
    <>
      <div className={cn("flex flex-col gap-2 mt-2", className)}>
        {imageAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {imageAttachments.map((attachment) => (
              <ImageAttachment
                key={attachment.id}
                attachment={attachment}
                workspaceId={workspaceId}
                onImageClick={handleImageClick}
                isHighlighted={attachment.id === hoveredAttachmentId}
              />
            ))}
          </div>
        )}
        {fileAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {fileAttachments.map((attachment) => (
              <FileAttachment
                key={attachment.id}
                attachment={attachment}
                workspaceId={workspaceId}
                isHighlighted={attachment.id === hoveredAttachmentId}
              />
            ))}
          </div>
        )}
      </div>

      <ImageLightbox
        isOpen={lightbox !== null}
        onClose={handleLightboxClose}
        imageUrl={lightbox?.url ?? null}
        filename={lightbox?.filename ?? ""}
      />
    </>
  )
}
