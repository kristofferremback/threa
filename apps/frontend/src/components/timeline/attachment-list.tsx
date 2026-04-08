import React, { useState, useCallback, useEffect, useMemo } from "react"
import { Download, FileText, File, Loader2, Copy, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { MediaGallery, type GalleryItem } from "@/components/image-gallery"
import { attachmentsApi } from "@/api"
import { cn } from "@/lib/utils"
import { downloadImage, copyImage, triggerDownload } from "@/lib/image-utils"
import { useAttachmentContext } from "@/lib/markdown/attachment-context"
import { useMediaGallery } from "@/contexts"
import { useIsMobile } from "@/hooks/use-mobile"
import { useLongPress } from "@/hooks/use-long-press"
import type { AttachmentSummary } from "@threa/types"

interface AttachmentListProps {
  attachments: AttachmentSummary[]
  workspaceId: string
  className?: string
  /** Defer image URL hydration until coordinated reveal completes */
  deferHydration?: boolean
}

interface AttachmentItemProps {
  attachment: AttachmentSummary
  workspaceId: string
  onImageClick?: (url: string, filename: string, attachmentId: string) => void
  onImageLoaded?: (attachmentId: string, url: string) => void
  isHighlighted?: boolean
  deferHydration?: boolean
}

interface VideoAttachmentItemProps {
  attachment: AttachmentSummary
  workspaceId: string
  onVideoClick?: (attachmentId: string) => void
  onThumbnailLoaded?: (attachmentId: string, thumbnailUrl: string) => void
  isHighlighted?: boolean
  deferHydration?: boolean
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

function ImageAttachment({
  attachment,
  workspaceId,
  onImageClick,
  onImageLoaded,
  isHighlighted,
  deferHydration = false,
}: AttachmentItemProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    if (deferHydration) return

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
  }, [workspaceId, attachment.id, onImageLoaded, deferHydration])

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

function VideoThumbnailContent({
  isProcessing,
  isLoading,
  error,
  thumbnailUrl,
  filename,
}: {
  isProcessing: boolean
  isLoading: boolean
  error: boolean
  thumbnailUrl: string | null
  filename: string
}) {
  if (isProcessing) {
    return (
      <div className="flex h-32 w-48 items-center justify-center">
        <div className="flex flex-col items-center gap-1.5">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Processing...</span>
        </div>
      </div>
    )
  }
  if (isLoading || error) {
    return (
      <div className="flex h-32 w-48 items-center justify-center">
        {error ? (
          <Play className="h-8 w-8 text-muted-foreground/50" />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </div>
    )
  }
  return (
    <div className="relative">
      <img src={thumbnailUrl!} alt={filename} className="h-32 w-auto max-w-xs object-cover" loading="lazy" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-10 w-10 rounded-full bg-black/60 flex items-center justify-center">
          <Play className="h-5 w-5 text-white ml-0.5" fill="white" />
        </div>
      </div>
    </div>
  )
}

function VideoAttachment({
  attachment,
  workspaceId,
  onVideoClick,
  onThumbnailLoaded,
  isHighlighted,
  deferHydration = false,
}: VideoAttachmentItemProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)

  const isProcessing = attachment.processingStatus === "pending" || attachment.processingStatus === "processing"
  const isFailed = attachment.processingStatus === "failed"

  useEffect(() => {
    if (deferHydration || isFailed) return

    let mounted = true

    async function loadThumbnail() {
      try {
        const url = await attachmentsApi.getDownloadUrl(workspaceId, attachment.id, { variant: "thumbnail" })
        if (mounted) {
          setThumbnailUrl(url)
          onThumbnailLoaded?.(attachment.id, url)
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

    loadThumbnail()

    return () => {
      mounted = false
    }
  }, [workspaceId, attachment.id, onThumbnailLoaded, deferHydration, isFailed])

  const handleClick = useCallback(() => {
    if (!isProcessing && !isFailed) {
      onVideoClick?.(attachment.id)
    }
  }, [isProcessing, isFailed, onVideoClick, attachment.id])

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

  // Failed videos render as file download buttons
  if (isFailed) {
    return <FileAttachment attachment={attachment} workspaceId={workspaceId} isHighlighted={isHighlighted} />
  }

  return (
    <div
      role="button"
      tabIndex={isProcessing || isLoading ? -1 : 0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      data-highlighted={isHighlighted || undefined}
      className={cn(
        "group/video relative overflow-hidden rounded-lg border bg-muted/30 transition-all",
        !isProcessing && "cursor-pointer hover:border-primary hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        isProcessing && "cursor-wait",
        isHighlighted && "ring-2 ring-primary border-primary shadow-sm"
      )}
    >
      <VideoThumbnailContent
        isProcessing={isProcessing}
        isLoading={isLoading}
        error={error}
        thumbnailUrl={thumbnailUrl}
        filename={attachment.filename}
      />
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
        <span className="block truncate text-xs text-white">{attachment.filename}</span>
      </div>
    </div>
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

export function AttachmentList({ attachments, workspaceId, className, deferHydration = false }: AttachmentListProps) {
  const [loadedUrls, setLoadedUrls] = useState<Map<string, string>>(new Map())
  const [loadedThumbnails, setLoadedThumbnails] = useState<Map<string, string>>(new Map())
  const [loadedVideoUrls, setLoadedVideoUrls] = useState<Map<string, string>>(new Map())
  const attachmentContext = useAttachmentContext()
  const hoveredAttachmentId = attachmentContext?.hoveredAttachmentId ?? null
  const { mediaAttachmentId, openMedia, closeMedia } = useMediaGallery()

  // Only claim ownership when the URL param references one of our attachments
  const attachmentIds = useMemo(() => new Set((attachments ?? []).map((a) => a.id)), [attachments])
  const selectedAttachmentId = mediaAttachmentId && attachmentIds.has(mediaAttachmentId) ? mediaAttachmentId : null

  const imageAttachments = useMemo(
    () => (attachments ?? []).filter((a) => a.mimeType.startsWith("image/")),
    [attachments]
  )
  // Use processingStatus as the video discriminator — the backend sets it for
  // all video attachments, including application/octet-stream files with video
  // extensions that wouldn't match a pure mimeType.startsWith("video/") check.
  const videoAttachments = useMemo(
    () =>
      (attachments ?? []).filter(
        (a) => !a.mimeType.startsWith("image/") && a.processingStatus && a.processingStatus !== "failed"
      ),
    [attachments]
  )
  const failedVideoAttachments = useMemo(
    () => (attachments ?? []).filter((a) => !a.mimeType.startsWith("image/") && a.processingStatus === "failed"),
    [attachments]
  )
  const fileAttachments = useMemo(
    () => (attachments ?? []).filter((a) => !a.mimeType.startsWith("image/") && !a.processingStatus),
    [attachments]
  )

  // Build gallery items from loaded URLs — images + completed videos
  const galleryItems: GalleryItem[] = useMemo(() => {
    const imageItems: GalleryItem[] = imageAttachments
      .map((a) => {
        const url = loadedUrls.get(a.id)
        if (!url) return null
        return { type: "image" as const, url, filename: a.filename, attachmentId: a.id }
      })
      .filter((g): g is NonNullable<typeof g> => g !== null)

    const videoItems: GalleryItem[] = videoAttachments
      .filter((a) => a.processingStatus === "completed" || a.processingStatus === "skipped")
      .map((a) => {
        const videoUrl = loadedVideoUrls.get(a.id) ?? ""
        const thumbnailUrl = loadedThumbnails.get(a.id) ?? ""
        return {
          type: "video" as const,
          url: videoUrl,
          thumbnailUrl,
          filename: a.filename,
          attachmentId: a.id,
        }
      })

    return [...imageItems, ...videoItems]
  }, [imageAttachments, videoAttachments, loadedUrls, loadedThumbnails, loadedVideoUrls])

  // Called by ImageAttachment children when their URL loads
  const registerImageUrl = useCallback((attachmentId: string, url: string) => {
    setLoadedUrls((prev) => {
      if (prev.get(attachmentId) === url) return prev
      const next = new Map(prev)
      next.set(attachmentId, url)
      return next
    })
  }, [])

  // Called by VideoAttachment children when their thumbnail loads
  const registerThumbnailUrl = useCallback((attachmentId: string, thumbnailUrl: string) => {
    setLoadedThumbnails((prev) => {
      if (prev.get(attachmentId) === thumbnailUrl) return prev
      const next = new Map(prev)
      next.set(attachmentId, thumbnailUrl)
      return next
    })
  }, [])

  // Track selected item by ID — derived index stays correct even as galleryItems grows
  const galleryIndex = selectedAttachmentId
    ? galleryItems.findIndex((g) => g.attachmentId === selectedAttachmentId)
    : -1

  const handleImageClick = useCallback(
    (_url: string, _filename: string, attachmentId: string) => {
      openMedia(attachmentId)
    },
    [openMedia]
  )

  const handleVideoClick = useCallback(
    (attachmentId: string) => {
      openMedia(attachmentId)
    },
    [openMedia]
  )

  // Eagerly fetch video URL when a video is selected (via click or URL param)
  useEffect(() => {
    if (!selectedAttachmentId) return
    const isVideo = videoAttachments.some((a) => a.id === selectedAttachmentId)
    if (!isVideo || loadedVideoUrls.has(selectedAttachmentId)) return

    let mounted = true
    async function fetchVideoUrl() {
      try {
        const url = await attachmentsApi.getDownloadUrl(workspaceId, selectedAttachmentId!, {
          variant: "processed",
        })
        if (mounted) {
          setLoadedVideoUrls((prev) => {
            const next = new Map(prev)
            next.set(selectedAttachmentId!, url)
            return next
          })
        }
      } catch {
        try {
          const url = await attachmentsApi.getDownloadUrl(workspaceId, selectedAttachmentId!)
          if (mounted) {
            setLoadedVideoUrls((prev) => {
              const next = new Map(prev)
              next.set(selectedAttachmentId!, url)
              return next
            })
          }
        } catch {
          console.error("Failed to get video URL")
        }
      }
    }
    fetchVideoUrl()
    return () => {
      mounted = false
    }
  }, [selectedAttachmentId, videoAttachments, loadedVideoUrls, workspaceId])

  if (!attachments || attachments.length === 0) {
    return null
  }

  const allFileAttachments = [...fileAttachments, ...failedVideoAttachments]

  return (
    <>
      <div className={cn("flex flex-col gap-2 mt-2", className)}>
        {(imageAttachments.length > 0 || videoAttachments.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {imageAttachments.map((attachment) => (
              <ImageAttachment
                key={attachment.id}
                attachment={attachment}
                workspaceId={workspaceId}
                onImageClick={handleImageClick}
                onImageLoaded={registerImageUrl}
                isHighlighted={attachment.id === hoveredAttachmentId}
                deferHydration={deferHydration}
              />
            ))}
            {videoAttachments.map((attachment) => (
              <VideoAttachment
                key={attachment.id}
                attachment={attachment}
                workspaceId={workspaceId}
                onVideoClick={handleVideoClick}
                onThumbnailLoaded={registerThumbnailUrl}
                isHighlighted={attachment.id === hoveredAttachmentId}
                deferHydration={deferHydration}
              />
            ))}
          </div>
        )}
        {allFileAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {allFileAttachments.map((attachment) => (
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

      <MediaGallery
        isOpen={selectedAttachmentId !== null && galleryIndex !== -1}
        onClose={closeMedia}
        items={galleryItems.length > 0 ? galleryItems : []}
        initialIndex={Math.max(0, galleryIndex)}
        workspaceId={workspaceId}
      />
    </>
  )
}
