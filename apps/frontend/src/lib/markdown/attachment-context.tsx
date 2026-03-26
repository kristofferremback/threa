import { createContext, useContext, useCallback, useMemo, useState, type ReactNode } from "react"
import { ImageGallery, type GalleryImage } from "@/components/image-gallery"
import { attachmentsApi } from "@/api"
import { triggerDownload } from "@/lib/image-utils"

interface Attachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
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
 * Enables attachment links to open images in gallery or trigger downloads.
 */
export function AttachmentProvider({ workspaceId, attachments, children }: AttachmentProviderProps) {
  const [galleryState, setGalleryState] = useState<{ images: GalleryImage[]; index: number } | null>(null)
  const [hoveredAttachmentId, setHoveredAttachmentId] = useState<string | null>(null)

  const imageAttachments = useMemo(() => attachments.filter((a) => a.mimeType.startsWith("image/")), [attachments])

  const openAttachment = useCallback(
    async (attachmentId: string, metaKey: boolean) => {
      const attachment = attachments.find((a) => a.id === attachmentId)
      if (!attachment) return

      const isImage = attachment.mimeType.startsWith("image/")

      try {
        if (metaKey) {
          const url = await attachmentsApi.getDownloadUrl(workspaceId, attachmentId)
          window.open(url, "_blank")
        } else if (isImage) {
          // Fetch clicked image URL immediately, open gallery, then backfill others
          const clickedUrl = await attachmentsApi.getDownloadUrl(workspaceId, attachmentId)
          const clickedIdx = imageAttachments.findIndex((a) => a.id === attachmentId)
          const initial: GalleryImage[] = imageAttachments.map((a) =>
            a.id === attachmentId
              ? { url: clickedUrl, filename: a.filename, attachmentId: a.id }
              : { url: "", filename: a.filename, attachmentId: a.id }
          )
          setGalleryState({ images: initial, index: clickedIdx !== -1 ? clickedIdx : 0 })

          // Backfill remaining image URLs in the background — allSettled so
          // a single failed fetch doesn't strand all other images as spinners
          const others = imageAttachments.filter((a) => a.id !== attachmentId)
          if (others.length > 0) {
            const settled = await Promise.allSettled(
              others.map(async (a) => {
                const url = await attachmentsApi.getDownloadUrl(workspaceId, a.id)
                return { attachmentId: a.id, url }
              })
            )
            const resolved = settled
              .filter(
                (r): r is PromiseFulfilledResult<{ attachmentId: string; url: string }> => r.status === "fulfilled"
              )
              .map((r) => r.value)
            if (resolved.length > 0) {
              setGalleryState((prev) => {
                if (!prev) return prev
                const updated = prev.images.map((img) => {
                  const found = resolved.find((r) => r.attachmentId === img.attachmentId)
                  return found ? { ...img, url: found.url } : img
                })
                return { ...prev, images: updated }
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
    [workspaceId, attachments, imageAttachments]
  )

  return (
    <AttachmentContext.Provider
      value={{ workspaceId, attachments, openAttachment, hoveredAttachmentId, setHoveredAttachmentId }}
    >
      {children}
      <ImageGallery
        isOpen={galleryState !== null}
        onClose={() => setGalleryState(null)}
        images={galleryState?.images ?? []}
        initialIndex={galleryState?.index ?? 0}
        workspaceId={workspaceId}
      />
    </AttachmentContext.Provider>
  )
}

export function useAttachmentContext(): AttachmentContextValue | null {
  return useContext(AttachmentContext)
}
