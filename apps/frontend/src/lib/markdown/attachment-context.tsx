import { createContext, useContext, useCallback, useState, type ReactNode } from "react"
import { ImageLightbox } from "@/components/image-lightbox"
import { attachmentsApi } from "@/api"

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
 * Enables attachment links to open images in lightbox or trigger downloads.
 */
export function AttachmentProvider({ workspaceId, attachments, children }: AttachmentProviderProps) {
  const [lightbox, setLightbox] = useState<{ url: string; filename: string } | null>(null)
  const [hoveredAttachmentId, setHoveredAttachmentId] = useState<string | null>(null)

  const openAttachment = useCallback(
    async (attachmentId: string, metaKey: boolean) => {
      const attachment = attachments.find((a) => a.id === attachmentId)
      if (!attachment) return

      const isImage = attachment.mimeType.startsWith("image/")

      try {
        const url = await attachmentsApi.getDownloadUrl(workspaceId, attachmentId)

        if (metaKey) {
          // Cmd/Ctrl+click: open in new tab
          window.open(url, "_blank")
        } else if (isImage) {
          // Click on image: open lightbox
          setLightbox({ url, filename: attachment.filename })
        } else {
          // Click on non-image: trigger download
          const link = document.createElement("a")
          link.href = url
          link.download = attachment.filename
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
        }
      } catch (error) {
        console.error("Failed to get attachment URL:", error)
      }
    },
    [workspaceId, attachments]
  )

  return (
    <AttachmentContext.Provider
      value={{ workspaceId, attachments, openAttachment, hoveredAttachmentId, setHoveredAttachmentId }}
    >
      {children}
      <ImageLightbox
        isOpen={lightbox !== null}
        onClose={() => setLightbox(null)}
        imageUrl={lightbox?.url ?? null}
        filename={lightbox?.filename ?? ""}
      />
    </AttachmentContext.Provider>
  )
}

export function useAttachmentContext(): AttachmentContextValue | null {
  return useContext(AttachmentContext)
}
