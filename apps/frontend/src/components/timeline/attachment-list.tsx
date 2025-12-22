import { useState, useCallback, useEffect } from "react"
import { Download, FileText, File, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
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
  onImageClick?: (url: string, filename: string) => void
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

function ImageAttachment({ attachment, workspaceId, onImageClick }: AttachmentItemProps) {
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
      className={cn(
        "relative overflow-hidden rounded-lg border bg-muted/30 transition-all",
        "hover:border-primary hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        "disabled:cursor-wait"
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

function FileAttachment({ attachment, workspaceId }: AttachmentItemProps) {
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
    <Button variant="outline" size="sm" className="h-8 gap-2 text-xs" onClick={handleDownload} disabled={isDownloading}>
      {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      <span className="max-w-[150px] truncate">{attachment.filename}</span>
      <span className="text-muted-foreground">{formatFileSize(attachment.sizeBytes)}</span>
      <Download className="h-3 w-3 opacity-50" />
    </Button>
  )
}

interface ImageLightboxProps {
  isOpen: boolean
  onClose: () => void
  imageUrl: string | null
  filename: string
}

function ImageLightbox({ isOpen, onClose, imageUrl, filename }: ImageLightboxProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 overflow-hidden bg-black/95 border-none">
        <DialogTitle className="sr-only">{filename}</DialogTitle>
        <DialogDescription className="sr-only">Full-size image preview</DialogDescription>
        <div className="relative flex items-center justify-center min-h-[50vh]">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-10 text-white hover:bg-white/20"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </Button>
          {imageUrl && <img src={imageUrl} alt={filename} className="max-w-full max-h-[85vh] object-contain" />}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
            <span className="text-sm text-white">{filename}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AttachmentList({ attachments, workspaceId, className }: AttachmentListProps) {
  const [lightbox, setLightbox] = useState<{ url: string; filename: string } | null>(null)

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
              />
            ))}
          </div>
        )}
        {fileAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {fileAttachments.map((attachment) => (
              <FileAttachment key={attachment.id} attachment={attachment} workspaceId={workspaceId} />
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
