import { createContext, useContext, useCallback, useState, type ReactNode } from "react"
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

  const imageAttachments = attachments.filter((a) => a.mimeType.startsWith("image/"))

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
          // Fetch URLs for all image attachments so the gallery can navigate between them
          const urls = await Promise.all(
            imageAttachments.map(async (a) => {
              const url = await attachmentsApi.getDownloadUrl(workspaceId, a.id)
              return { url, filename: a.filename, attachmentId: a.id }
            })
          )
          const idx = urls.findIndex((u) => u.attachmentId === attachmentId)
          setGalleryState({ images: urls, index: idx !== -1 ? idx : 0 })
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
      {galleryState && (
        <ImageGallery
          isOpen
          onClose={() => setGalleryState(null)}
          images={galleryState.images}
          initialIndex={galleryState.index}
          workspaceId={workspaceId}
        />
      )}
    </AttachmentContext.Provider>
  )
}

export function useAttachmentContext(): AttachmentContextValue | null {
  return useContext(AttachmentContext)
}
