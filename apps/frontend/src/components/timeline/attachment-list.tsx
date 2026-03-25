import React, { useState, useCallback, useEffect, useMemo } from "react"
import { Download, FileText, File, Loader2, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { ImageGallery, type GalleryImage } from "@/components/image-gallery"
import { attachmentsApi } from "@/api"
import { cn } from "@/lib/utils"
import { downloadImage, copyImage, triggerDownload } from "@/lib/image-utils"
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
  onImageClick?: (url: string, filename: string, attachmentId: string) => void
  onImageLoaded?: (attachmentId: string, url: string) => void
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
  workspaceId,
  attachmentId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  imageUrl: string
  filename: string
  workspaceId: string
  attachmentId: string
}) {
  const handleDownload = useCallback(() => {
    onOpenChange(false)
    downloadImage(workspaceId, attachmentId, filename)
  }, [workspaceId, attachmentId, filename, onOpenChange])

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

function ImageAttachment({ attachment, workspaceId, onImageClick, onImageLoaded, isHighlighted }: AttachmentItemProps) {
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
          onImageLoaded?.(attachment.id, url)
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
  }, [workspaceId, attachment.id, onImageLoaded])

  const handleClick = useCallback(() => {
    if (imageUrl && onImageClick) {
      onImageClick(imageUrl, attachment.filename, attachment.id)
    }
  }, [imageUrl, onImageClick, attachment.filename, attachment.id])

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
    downloadImage(workspaceId, attachment.id, attachment.filename)
  }, [workspaceId, attachment.id, attachment.filename])

  const handleCopy = useCallback(() => {
    if (imageUrl) copyImage(imageUrl)
  }, [imageUrl])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return
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
          workspaceId={workspaceId}
          attachmentId={attachment.id}
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
        triggerDownload(url, attachment.filename)
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
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null)
  const [loadedUrls, setLoadedUrls] = useState<Map<string, string>>(new Map())
  const attachmentContext = useAttachmentContext()
  const hoveredAttachmentId = attachmentContext?.hoveredAttachmentId ?? null

  const imageAttachments = useMemo(
    () => (attachments ?? []).filter((a) => a.mimeType.startsWith("image/")),
    [attachments]
  )
  const fileAttachments = useMemo(
    () => (attachments ?? []).filter((a) => !a.mimeType.startsWith("image/")),
    [attachments]
  )

  // Build gallery images from loaded URLs — stable reference when loadedUrls / attachments unchanged
  const galleryImages: GalleryImage[] = useMemo(
    () =>
      imageAttachments
        .map((a) => {
          const url = loadedUrls.get(a.id)
          if (!url) return null
          return { url, filename: a.filename, attachmentId: a.id }
        })
        .filter((g): g is GalleryImage => g !== null),
    [imageAttachments, loadedUrls]
  )

  // Called by ImageAttachment children when their URL loads
  const registerImageUrl = useCallback((attachmentId: string, url: string) => {
    setLoadedUrls((prev) => {
      if (prev.get(attachmentId) === url) return prev
      const next = new Map(prev)
      next.set(attachmentId, url)
      return next
    })
  }, [])

  // Track selected image by ID — derived index stays correct even as galleryImages grows
  const galleryIndex = selectedAttachmentId
    ? galleryImages.findIndex((g) => g.attachmentId === selectedAttachmentId)
    : -1

  const handleImageClick = useCallback((_url: string, _filename: string, attachmentId: string) => {
    setSelectedAttachmentId(attachmentId)
  }, [])

  const handleGalleryClose = useCallback(() => setSelectedAttachmentId(null), [])

  if (!attachments || attachments.length === 0) {
    return null
  }

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
                onImageLoaded={registerImageUrl}
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

      {galleryImages.length > 0 && galleryIndex !== -1 && (
        <ImageGallery
          isOpen={selectedAttachmentId !== null}
          onClose={handleGalleryClose}
          images={galleryImages}
          initialIndex={galleryIndex}
          workspaceId={workspaceId}
        />
      )}
    </>
  )
}
