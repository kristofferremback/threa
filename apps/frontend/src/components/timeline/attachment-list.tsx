import React, { useState, useCallback, useEffect } from "react"
import { Download, FileText, File, Loader2, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { ImageLightbox } from "@/components/image-lightbox"
import { attachmentsApi } from "@/api"
import { cn } from "@/lib/utils"
import { downloadImage, copyImage } from "@/lib/image-utils"
import { useAttachmentContext } from "@/lib/markdown/attachment-context"
import { useIsMobile } from "@/hooks/use-mobile"
import { useLongPress } from "@/hooks/use-long-press"
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

function ImageActionDrawer({
  open,
  onOpenChange,
  imageUrl,
  filename,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  imageUrl: string
  filename: string
}) {
  const handleDownload = useCallback(() => {
    onOpenChange(false)
    downloadImage(imageUrl, filename)
  }, [imageUrl, filename, onOpenChange])

  const handleCopy = useCallback(() => {
    onOpenChange(false)
    copyImage(imageUrl)
  }, [imageUrl, onOpenChange])

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerTitle className="sr-only">Image actions</DrawerTitle>
        <div className="px-4 pt-1 pb-3">
          <div className="rounded-xl bg-muted/60 px-3.5 py-2.5">
            <p className="text-sm text-foreground/80 truncate">{filename}</p>
          </div>
        </div>
        <div className="px-2 pb-[max(12px,env(safe-area-inset-bottom))]">
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm active:bg-muted/80 transition-colors"
            onClick={handleDownload}
          >
            <Download className="h-[18px] w-[18px] text-muted-foreground shrink-0" />
            <span>Save image</span>
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm active:bg-muted/80 transition-colors"
            onClick={handleCopy}
          >
            <Copy className="h-[18px] w-[18px] text-muted-foreground shrink-0" />
            <span>Copy image</span>
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function ImageAttachment({ attachment, workspaceId, onImageClick, isHighlighted }: AttachmentItemProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const isMobile = useIsMobile()

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

  const openDrawer = useCallback(() => setDrawerOpen(true), [])
  const longPressRaw = useLongPress({
    onLongPress: openDrawer,
    enabled: isMobile && !!imageUrl,
  })

  // Wrap touch handlers to stop propagation — prevents the message-level
  // long-press from firing when the user holds on an image.
  const longPress = {
    isPressed: longPressRaw.isPressed,
    handlers: {
      onTouchStart: (e: React.TouchEvent) => {
        e.stopPropagation()
        longPressRaw.handlers.onTouchStart(e)
      },
      onTouchEnd: () => longPressRaw.handlers.onTouchEnd(),
      onTouchMove: (e: React.TouchEvent) => longPressRaw.handlers.onTouchMove(e),
      onContextMenu: (e: React.MouseEvent) => {
        e.stopPropagation()
        longPressRaw.handlers.onContextMenu(e)
      },
    },
  }

  const handleDownload = useCallback(() => {
    if (imageUrl) downloadImage(imageUrl, attachment.filename)
  }, [imageUrl, attachment.filename])

  const handleCopy = useCallback(() => {
    if (imageUrl) copyImage(imageUrl)
  }, [imageUrl])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        handleClick()
      }
    },
    [handleClick]
  )

  if (error) {
    return <div className="rounded-lg border bg-muted/50 p-2 text-xs text-muted-foreground">Failed to load image</div>
  }

  return (
    <>
      <div
        role="button"
        tabIndex={isLoading || !imageUrl ? -1 : 0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        data-highlighted={isHighlighted || undefined}
        {...(isMobile ? longPress.handlers : {})}
        className={cn(
          "group/image relative overflow-hidden rounded-lg border bg-muted/30 transition-all cursor-pointer",
          "hover:border-primary hover:shadow-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          (isLoading || !imageUrl) && "cursor-wait",
          isHighlighted && "ring-2 ring-primary border-primary shadow-sm",
          longPress.isPressed && "opacity-70 transition-opacity duration-100"
        )}
      >
        {isLoading ? (
          <div className="flex h-32 w-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <img src={imageUrl!} alt={attachment.filename} className="h-32 w-auto max-w-xs object-cover" loading="lazy" />
        )}
        {/* Desktop: show action buttons on hover; Mobile: just filename */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
          <div className="flex items-center gap-1">
            <span className="block truncate text-xs text-white flex-1">{attachment.filename}</span>
            <div className="hidden sm:flex items-center gap-0.5 shrink-0 opacity-0 group-hover/image:opacity-100 transition-opacity">
              <button
                type="button"
                className="rounded p-1 text-white/80 hover:text-white hover:bg-white/20 transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDownload()
                }}
                title="Download image"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded p-1 text-white/80 hover:text-white hover:bg-white/20 transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  handleCopy()
                }}
                title="Copy image"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
      {isMobile && imageUrl && (
        <ImageActionDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          imageUrl={imageUrl}
          filename={attachment.filename}
        />
      )}
    </>
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
