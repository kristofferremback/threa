import { createContext, useContext, useCallback, useState, type ReactNode } from "react"
import { attachmentsApi } from "@/api"
import { triggerDownload } from "@/lib/image-utils"
import { useMediaGallery } from "@/contexts"

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
 *
 * Gallery display is delegated to the sibling AttachmentList via the shared
 * ?media= URL parameter (MediaGalleryContext).
 */
export function AttachmentProvider({ workspaceId, attachments, children }: AttachmentProviderProps) {
  const [hoveredAttachmentId, setHoveredAttachmentId] = useState<string | null>(null)
  const { openMedia } = useMediaGallery()

  const openAttachment = useCallback(
    async (attachmentId: string, metaKey: boolean) => {
      const attachment = attachments.find((a) => a.id === attachmentId)
      if (!attachment) return

      const isImage = attachment.mimeType.startsWith("image/")
      const isVideo = !isImage && !!attachment.processingStatus
      const isPlayableVideo =
        isVideo && (attachment.processingStatus === "completed" || attachment.processingStatus === "skipped")

      try {
        if (metaKey) {
          const url = await attachmentsApi.getDownloadUrl(workspaceId, attachmentId)
          window.open(url, "_blank")
        } else if (isImage || isPlayableVideo) {
          openMedia(attachmentId)
        } else {
          const url = await attachmentsApi.getDownloadUrl(workspaceId, attachmentId)
          triggerDownload(url, attachment.filename)
        }
      } catch (error) {
        console.error("Failed to get attachment URL:", error)
      }
    },
    [workspaceId, attachments, openMedia]
  )

  return (
    <AttachmentContext.Provider
      value={{ workspaceId, attachments, openAttachment, hoveredAttachmentId, setHoveredAttachmentId }}
    >
      {children}
    </AttachmentContext.Provider>
  )
}

export function useAttachmentContext(): AttachmentContextValue | null {
  return useContext(AttachmentContext)
}
