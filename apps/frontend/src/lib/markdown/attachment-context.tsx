import { createContext, useContext, useCallback, useMemo, useState, type ReactNode } from "react"
import { MediaGallery, type GalleryItem } from "@/components/image-gallery"
import { attachmentsApi } from "@/api"
import { triggerDownload } from "@/lib/image-utils"

interface Attachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  processingStatus?: string
}

interface AttachmentContextValue {
  workspaceId: string
  attachments: Attachment[]
  openAttachment: (attachmentId: string, metaKey: boolean) => void
  hoveredAttachmentId: string | null
  setHoveredAttachmentId: (id: string | null) => void
}

const AttachmentContext = createContext<AttachmentContextValue | null>(null)

interface AttachmentProviderProps {
  workspaceId: string
  attachments: Attachment[]
  children: ReactNode
}

/**
 * Provider for attachment context in rendered markdown.
 * Enables attachment links to open images/videos in gallery or trigger downloads.
 */
export function AttachmentProvider({ workspaceId, attachments, children }: AttachmentProviderProps) {
  const [galleryState, setGalleryState] = useState<{ items: GalleryItem[]; index: number } | null>(null)
  const [hoveredAttachmentId, setHoveredAttachmentId] = useState<string | null>(null)

  const imageAttachments = useMemo(() => attachments.filter((a) => a.mimeType.startsWith("image/")), [attachments])
  const videoAttachments = useMemo(
    () =>
      attachments.filter(
        (a) =>
          a.mimeType.startsWith("video/") && (a.processingStatus === "completed" || a.processingStatus === "skipped")
      ),
    [attachments]
  )

  const openAttachment = useCallback(
    async (attachmentId: string, metaKey: boolean) => {
      const attachment = attachments.find((a) => a.id === attachmentId)
      if (!attachment) return

      const isImage = attachment.mimeType.startsWith("image/")
      const isVideo = attachment.mimeType.startsWith("video/")
      const isPlayableVideo =
        isVideo && (attachment.processingStatus === "completed" || attachment.processingStatus === "skipped")

      try {
        if (metaKey) {
          const url = await attachmentsApi.getDownloadUrl(workspaceId, attachmentId)
          window.open(url, "_blank")
        } else if (isImage) {
          // Fetch clicked image URL immediately, open gallery, then backfill others
          const clickedUrl = await attachmentsApi.getDownloadUrl(workspaceId, attachmentId)
          const allMedia = [...imageAttachments, ...videoAttachments]
          const clickedIdx = allMedia.findIndex((a) => a.id === attachmentId)

          const initial: GalleryItem[] = allMedia.map((a) => {
            if (a.mimeType.startsWith("video/")) {
              return {
                type: "video" as const,
                url: "",
                thumbnailUrl: "",
                filename: a.filename,
                attachmentId: a.id,
              }
            }
            return {
              type: "image" as const,
              url: a.id === attachmentId ? clickedUrl : "",
              filename: a.filename,
              attachmentId: a.id,
            }
          })
          setGalleryState({ items: initial, index: clickedIdx !== -1 ? clickedIdx : 0 })

          // Backfill remaining URLs in the background
          const others = allMedia.filter((a) => a.id !== attachmentId)
          if (others.length > 0) {
            const settled = await Promise.allSettled(
              others.map(async (a) => {
                if (a.mimeType.startsWith("video/")) {
                  const [videoUrl, thumbUrl] = await Promise.all([
                    attachmentsApi.getDownloadUrl(workspaceId, a.id, { variant: "processed" }).catch(() => ""),
                    attachmentsApi.getDownloadUrl(workspaceId, a.id, { variant: "thumbnail" }).catch(() => ""),
                  ])
                  return { attachmentId: a.id, url: videoUrl, thumbnailUrl: thumbUrl, type: "video" as const }
                }
                const url = await attachmentsApi.getDownloadUrl(workspaceId, a.id)
                return { attachmentId: a.id, url, type: "image" as const }
              })
            )
            const resolved = settled
              .filter((r) => r.status === "fulfilled")
              .map(
                (r) =>
                  (
                    r as PromiseFulfilledResult<{
                      attachmentId: string
                      url: string
                      thumbnailUrl?: string
                      type: "image" | "video"
                    }>
                  ).value
              )
            if (resolved.length > 0) {
              setGalleryState((prev) => {
                if (!prev) return prev
                const updated = prev.items.map((item) => {
                  const found = resolved.find((r) => r.attachmentId === item.attachmentId)
                  if (!found) return item
                  if (found.type === "video" && item.type === "video") {
                    return { ...item, url: found.url, thumbnailUrl: found.thumbnailUrl ?? "" }
                  }
                  if (found.type === "image" && item.type === "image") {
                    return { ...item, url: found.url }
                  }
                  return item
                })
                return { ...prev, items: updated }
              })
            }
          }
        } else if (isPlayableVideo) {
          // Fetch processed video + thumbnail URL, open gallery
          const [videoUrl, thumbnailUrl] = await Promise.all([
            attachmentsApi
              .getDownloadUrl(workspaceId, attachmentId, { variant: "processed" })
              .catch(() => attachmentsApi.getDownloadUrl(workspaceId, attachmentId)),
            attachmentsApi.getDownloadUrl(workspaceId, attachmentId, { variant: "thumbnail" }).catch(() => ""),
          ])

          const allMedia = [...imageAttachments, ...videoAttachments]
          const clickedIdx = allMedia.findIndex((a) => a.id === attachmentId)

          const initial: GalleryItem[] = allMedia.map((a) => {
            if (a.id === attachmentId) {
              return {
                type: "video" as const,
                url: videoUrl,
                thumbnailUrl,
                filename: a.filename,
                attachmentId: a.id,
              }
            }
            if (a.mimeType.startsWith("video/")) {
              return { type: "video" as const, url: "", thumbnailUrl: "", filename: a.filename, attachmentId: a.id }
            }
            return { type: "image" as const, url: "", filename: a.filename, attachmentId: a.id }
          })
          setGalleryState({ items: initial, index: clickedIdx !== -1 ? clickedIdx : 0 })

          // Backfill others
          const others = allMedia.filter((a) => a.id !== attachmentId)
          if (others.length > 0) {
            const settled = await Promise.allSettled(
              others.map(async (a) => {
                if (a.mimeType.startsWith("video/")) {
                  const [vUrl, tUrl] = await Promise.all([
                    attachmentsApi.getDownloadUrl(workspaceId, a.id, { variant: "processed" }).catch(() => ""),
                    attachmentsApi.getDownloadUrl(workspaceId, a.id, { variant: "thumbnail" }).catch(() => ""),
                  ])
                  return { attachmentId: a.id, url: vUrl, thumbnailUrl: tUrl, type: "video" as const }
                }
                const url = await attachmentsApi.getDownloadUrl(workspaceId, a.id)
                return { attachmentId: a.id, url, type: "image" as const }
              })
            )
            const resolved = settled
              .filter((r) => r.status === "fulfilled")
              .map(
                (r) =>
                  (
                    r as PromiseFulfilledResult<{
                      attachmentId: string
                      url: string
                      thumbnailUrl?: string
                      type: "image" | "video"
                    }>
                  ).value
              )
            if (resolved.length > 0) {
              setGalleryState((prev) => {
                if (!prev) return prev
                const updated = prev.items.map((item) => {
                  const found = resolved.find((r) => r.attachmentId === item.attachmentId)
                  if (!found) return item
                  if (found.type === "video" && item.type === "video") {
                    return { ...item, url: found.url, thumbnailUrl: found.thumbnailUrl ?? "" }
                  }
                  if (found.type === "image" && item.type === "image") {
                    return { ...item, url: found.url }
                  }
                  return item
                })
                return { ...prev, items: updated }
              })
            }
          }
        } else {
          const url = await attachmentsApi.getDownloadUrl(workspaceId, attachmentId)
          triggerDownload(url, attachment.filename)
        }
      } catch (error) {
        console.error("Failed to get attachment URL:", error)
      }
    },
    [workspaceId, attachments, imageAttachments, videoAttachments]
  )

  return (
    <AttachmentContext.Provider
      value={{ workspaceId, attachments, openAttachment, hoveredAttachmentId, setHoveredAttachmentId }}
    >
      {children}
      <MediaGallery
        isOpen={galleryState !== null}
        onClose={() => setGalleryState(null)}
        items={galleryState?.items ?? []}
        initialIndex={galleryState?.index ?? 0}
        workspaceId={workspaceId}
      />
    </AttachmentContext.Provider>
  )
}

export function useAttachmentContext(): AttachmentContextValue | null {
  return useContext(AttachmentContext)
}
