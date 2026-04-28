import { useEffect, useState, useCallback } from "react"
import { Download, FileText, File, Image as ImageIcon, Film, FileSpreadsheet, FileType } from "lucide-react"
import { cn } from "@/lib/utils"
import { attachmentsApi } from "@/api"
import { triggerDownload } from "@/lib/image-utils"
import { RelativeTime } from "@/components/relative-time"
import { Button } from "@/components/ui/button"
import { useMediaGallery } from "@/contexts"
import { useIsMobile } from "@/hooks/use-mobile"
import { AssetKinds, type AssetSearchResult } from "@threa/types"

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function KindIcon({ kind }: { kind: AssetSearchResult["kind"] }) {
  switch (kind) {
    case AssetKinds.IMAGE:
      return <ImageIcon className="h-5 w-5 text-muted-foreground" />
    case AssetKinds.VIDEO:
      return <Film className="h-5 w-5 text-muted-foreground" />
    case AssetKinds.PDF:
      return <FileText className="h-5 w-5 text-muted-foreground" />
    case AssetKinds.DOCUMENT:
      return <FileType className="h-5 w-5 text-muted-foreground" />
    case AssetKinds.SPREADSHEET:
      return <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
    case AssetKinds.TEXT:
      return <FileText className="h-5 w-5 text-muted-foreground" />
    default:
      return <File className="h-5 w-5 text-muted-foreground" />
  }
}

interface AssetThumbnailProps {
  asset: AssetSearchResult
  workspaceId: string
}

function AssetThumbnail({ asset, workspaceId }: AssetThumbnailProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)

  const wantsImage = asset.kind === AssetKinds.IMAGE && asset.hasThumbnail
  const wantsVideoThumb = asset.kind === AssetKinds.VIDEO && asset.hasThumbnail

  useEffect(() => {
    if (!wantsImage && !wantsVideoThumb) return
    let active = true
    ;(async () => {
      try {
        const url = await attachmentsApi.getDownloadUrl(workspaceId, asset.id, {
          variant: wantsVideoThumb ? "thumbnail" : undefined,
        })
        if (active) setThumbnailUrl(url)
      } catch {
        if (active) setErrored(true)
      }
    })()
    return () => {
      active = false
    }
  }, [asset.id, workspaceId, wantsImage, wantsVideoThumb])

  if ((!wantsImage && !wantsVideoThumb) || errored) {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border bg-muted/30">
        <KindIcon kind={asset.kind} />
      </div>
    )
  }

  if (!thumbnailUrl) {
    return <div className="h-11 w-11 shrink-0 animate-pulse rounded-md border bg-muted" />
  }

  return (
    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md border bg-muted">
      <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      {asset.kind === AssetKinds.VIDEO && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Film className="h-3.5 w-3.5 text-white" />
        </div>
      )}
    </div>
  )
}

interface AssetItemProps {
  asset: AssetSearchResult
  workspaceId: string
  uploaderName: string | null
  /** Stream display name for the asset's source stream, when known. */
  streamName: string | null
}

export function AssetItem({ asset, workspaceId, uploaderName, streamName }: AssetItemProps) {
  const { openMedia } = useMediaGallery()
  const isMobile = useIsMobile()

  const isPreviewable = asset.kind === AssetKinds.IMAGE || asset.kind === AssetKinds.VIDEO

  const handleOpen = useCallback(async () => {
    if (isPreviewable) {
      openMedia(asset.id)
      return
    }
    // Non-previewable: open in a new tab for PDFs (browsers preview them
    // natively); fall back to a download attribute for everything else.
    try {
      const url = await attachmentsApi.getDownloadUrl(workspaceId, asset.id)
      if (asset.mimeType === "application/pdf") {
        window.open(url, "_blank", "noopener,noreferrer")
      } else {
        triggerDownload(url, asset.filename)
      }
    } catch {
      console.error("Failed to fetch download URL for asset", asset.id)
    }
  }, [asset, isPreviewable, openMedia, workspaceId])

  const handleDownload = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      try {
        const url = await attachmentsApi.getDownloadUrl(workspaceId, asset.id, { download: true })
        triggerDownload(url, asset.filename)
      } catch {
        console.error("Failed to download asset", asset.id)
      }
    },
    [asset.id, asset.filename, workspaceId]
  )

  // Show extraction summary only when it's both present and meaningfully
  // different from the filename — for an image named "chart.png" with a
  // summary "Chart of Q3 sales" the snippet is useful; for a doc whose
  // summary just repeats the filename it'd be noise.
  const showPreview =
    asset.preview !== null &&
    asset.preview.trim().length > 0 &&
    asset.preview.trim().toLowerCase() !== asset.filename.trim().toLowerCase()

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          handleOpen()
        }
      }}
      className={cn(
        "group flex items-start gap-3 rounded-md px-2 py-2 transition-colors cursor-pointer",
        "hover:bg-muted/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      )}
    >
      <AssetThumbnail asset={asset} workspaceId={workspaceId} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium" title={asset.filename}>
            {asset.filename}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatFileSize(asset.sizeBytes)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <RelativeTime date={asset.createdAt} terse />
          {uploaderName && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate" title={uploaderName}>
                {uploaderName}
              </span>
            </>
          )}
          {streamName && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate" title={streamName}>
                in {streamName}
              </span>
            </>
          )}
        </div>
        {showPreview && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80" title={asset.preview ?? undefined}>
            {asset.preview}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-8 w-8 shrink-0 transition-opacity",
          // Hover affordance hides the action on desktop until the user
          // intends to interact, but keep it visible on touch where there
          // is no hover state to reveal it.
          isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        )}
        onClick={handleDownload}
        aria-label={`Download ${asset.filename}`}
      >
        <Download className="h-4 w-4" />
      </Button>
    </div>
  )
}
