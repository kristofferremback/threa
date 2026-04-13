import { createContext, useContext, useCallback, useMemo, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"

interface MediaGalleryContextValue {
  /** Attachment ID from the ?media= search param, or null */
  mediaAttachmentId: string | null
  /** Open the media gallery for a given attachment */
  openMedia: (attachmentId: string) => void
  /** Close the media gallery */
  closeMedia: () => void
}

const MediaGalleryContext = createContext<MediaGalleryContextValue | null>(null)

interface MediaGalleryProviderProps {
  children: ReactNode
}

export function MediaGalleryProvider({ children }: MediaGalleryProviderProps) {
  const [searchParams, setSearchParams] = useSearchParams()

  const mediaAttachmentId = useMemo(() => {
    return searchParams.get("media")
  }, [searchParams])

  const openMedia = useCallback(
    (attachmentId: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set("media", attachmentId)
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  const closeMedia = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete("media")
        return next
      },
      { replace: true }
    )
  }, [setSearchParams])

  const value = useMemo<MediaGalleryContextValue>(
    () => ({
      mediaAttachmentId,
      openMedia,
      closeMedia,
    }),
    [mediaAttachmentId, openMedia, closeMedia]
  )

  return <MediaGalleryContext.Provider value={value}>{children}</MediaGalleryContext.Provider>
}

export function useMediaGallery(): MediaGalleryContextValue {
  const context = useContext(MediaGalleryContext)
  if (!context) {
    throw new Error("useMediaGallery must be used within a MediaGalleryProvider")
  }
  return context
}
