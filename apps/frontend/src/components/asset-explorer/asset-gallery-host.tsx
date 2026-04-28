import { useEffect, useMemo, useState } from "react"
import { attachmentsApi } from "@/api"
import { MediaGallery, type GalleryItem } from "@/components/image-gallery"
import { useMediaGallery } from "@/contexts"
import { AssetKinds, type AssetSearchResult } from "@threa/types"

/**
 * Renders a `MediaGallery` for the previewable subset of an asset-explorer
 * page (images + completed videos). Each visible asset's URL is fetched on
 * demand so a flat result list with thousands of images doesn't fan out
 * thousands of presigned-URL requests up front.
 *
 * Lifts the URL-bookkeeping pattern out of `AttachmentList` into a single
 * place so the explorer doesn't need to coordinate per-item registration —
 * it just hands over the result list.
 *
 * Listens for the `?media=<attachmentId>` URL param via {@link useMediaGallery}.
 * Only claims ownership when the param matches one of our previewable assets,
 * so this doesn't fight `AttachmentList` instances rendered for messages.
 */
interface AssetGalleryHostProps {
  workspaceId: string
  results: AssetSearchResult[]
}

export function AssetGalleryHost({ workspaceId, results }: AssetGalleryHostProps) {
  const { mediaAttachmentId, openMedia, closeMedia } = useMediaGallery()

  const previewable = useMemo(
    () =>
      results.filter(
        (r) => r.kind === AssetKinds.IMAGE || (r.kind === AssetKinds.VIDEO && r.processingStatus === "completed")
      ),
    [results]
  )

  const previewableIds = useMemo(() => new Set(previewable.map((p) => p.id)), [previewable])
  const ownsGallery = mediaAttachmentId !== null && previewableIds.has(mediaAttachmentId)

  // URL caches keyed by attachmentId. Maps are only mutated through `set` so
  // shallow equality holds across React renders that don't actually change
  // the entry — the Map is recreated on insert (matches AttachmentList's
  // pattern).
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(() => new Map())
  const [videoUrls, setVideoUrls] = useState<Map<string, string>>(() => new Map())
  const [thumbnailUrls, setThumbnailUrls] = useState<Map<string, string>>(() => new Map())

  // Hydrate the active item's URL when the gallery opens or the user navigates.
  useEffect(() => {
    if (!ownsGallery || mediaAttachmentId === null) return
    const asset = previewable.find((p) => p.id === mediaAttachmentId)
    if (!asset) return

    let active = true
    if (asset.kind === AssetKinds.IMAGE) {
      if (imageUrls.has(asset.id)) return
      ;(async () => {
        try {
          const url = await attachmentsApi.getDownloadUrl(workspaceId, asset.id)
          if (active) setImageUrls((prev) => new Map(prev).set(asset.id, url))
        } catch {
          /* gallery falls back to its own loading/error state */
        }
      })()
    } else if (asset.kind === AssetKinds.VIDEO) {
      // Video: fetch processed URL + thumbnail in parallel.
      if (!videoUrls.has(asset.id)) {
        ;(async () => {
          try {
            const url = await attachmentsApi.getDownloadUrl(workspaceId, asset.id, { variant: "processed" })
            if (active) setVideoUrls((prev) => new Map(prev).set(asset.id, url))
          } catch {
            try {
              const url = await attachmentsApi.getDownloadUrl(workspaceId, asset.id)
              if (active) setVideoUrls((prev) => new Map(prev).set(asset.id, url))
            } catch {
              /* swallow */
            }
          }
        })()
      }
      if (!thumbnailUrls.has(asset.id)) {
        ;(async () => {
          try {
            const url = await attachmentsApi.getDownloadUrl(workspaceId, asset.id, { variant: "thumbnail" })
            if (active) setThumbnailUrls((prev) => new Map(prev).set(asset.id, url))
          } catch {
            /* swallow */
          }
        })()
      }
    }

    return () => {
      active = false
    }
  }, [ownsGallery, mediaAttachmentId, previewable, workspaceId, imageUrls, videoUrls, thumbnailUrls])

  const items: GalleryItem[] = useMemo(() => {
    return previewable.map((asset) =>
      asset.kind === AssetKinds.IMAGE
        ? {
            type: "image" as const,
            url: imageUrls.get(asset.id) ?? "",
            filename: asset.filename,
            attachmentId: asset.id,
          }
        : {
            type: "video" as const,
            url: videoUrls.get(asset.id) ?? "",
            thumbnailUrl: thumbnailUrls.get(asset.id) ?? "",
            filename: asset.filename,
            attachmentId: asset.id,
          }
    )
  }, [previewable, imageUrls, videoUrls, thumbnailUrls])

  const initialIndex = ownsGallery ? items.findIndex((i) => i.attachmentId === mediaAttachmentId) : -1

  if (!ownsGallery || initialIndex === -1) return null

  return (
    <MediaGallery
      isOpen
      onClose={closeMedia}
      items={items}
      initialIndex={Math.max(0, initialIndex)}
      workspaceId={workspaceId}
      onItemChange={openMedia}
    />
  )
}
