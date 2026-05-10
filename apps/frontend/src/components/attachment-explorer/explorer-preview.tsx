import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { categoryFromMime } from "@threa/types"
import { Download, ExternalLink, Hash } from "lucide-react"
import { attachmentsApi, type AttachmentSearchItem } from "@/api/attachments"
import { Button } from "@/components/ui/button"
import { useFormattedDate } from "@/hooks"
import { stripMarkdownToInline } from "@/lib/markdown"
import { CATEGORY_META } from "./category"
import { formatFileSize } from "./format"

interface ExplorerPreviewProps {
  workspaceId: string
  item: AttachmentSearchItem | null
}

export function ExplorerPreview({ workspaceId, item }: ExplorerPreviewProps) {
  const { formatFull } = useFormattedDate()
  const navigate = useNavigate()
  const [rawUrl, setRawUrl] = useState<string | null>(null)
  const [processedUrl, setProcessedUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const category = item ? categoryFromMime(item.mimeType) : null

  useEffect(() => {
    setRawUrl(null)
    setProcessedUrl(null)
    setPreviewError(null)
    if (!item) return
    let cancelled = false
    attachmentsApi
      .getDownloadUrl(workspaceId, item.id, { variant: "raw" })
      .then((url) => {
        if (!cancelled) setRawUrl(url)
      })
      .catch((err) => {
        if (cancelled) return
        setPreviewError(err instanceof Error ? err.message : "Failed to load preview")
      })
    if (category === "video" && item.processingStatus === "completed") {
      attachmentsApi
        .getDownloadUrl(workspaceId, item.id, { variant: "processed" })
        .then((url) => {
          if (!cancelled) setProcessedUrl(url)
        })
        .catch(() => {
          // Processed variant is optional — fall back to raw silently.
        })
    }
    return () => {
      cancelled = true
    }
  }, [workspaceId, item, category])

  if (!item || !category) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground">
        Select a file to preview it here.
      </div>
    )
  }

  const selected = item
  const meta = CATEGORY_META[category]
  const Icon = meta.icon
  const sourceUrl =
    selected.streamId && selected.messageId ? `/w/${workspaceId}/s/${selected.streamId}?m=${selected.messageId}` : null
  // Browsers handle iPhone .mov source poorly; prefer the transcoded mp4 when ready.
  const playbackUrl = category === "video" ? (processedUrl ?? rawUrl) : rawUrl

  function renderMedia() {
    if (previewError) {
      return <div className="px-6 py-4 text-xs text-muted-foreground">{previewError}</div>
    }
    if (!rawUrl) {
      return (
        <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${meta.accent}`}>
          <Icon className="h-8 w-8" />
        </div>
      )
    }
    if (category === "image") {
      return (
        <img src={rawUrl} alt={selected.filename} className="block max-h-[50vh] min-w-0 max-w-full object-contain" />
      )
    }
    if (category === "video") {
      return <video src={playbackUrl ?? undefined} controls className="block max-h-[50vh] min-w-0 max-w-full" />
    }
    if (category === "audio") {
      return (
        <div className="w-full px-6">
          <audio src={rawUrl} controls className="w-full" />
        </div>
      )
    }
    return (
      <a href={rawUrl} target="_blank" rel="noreferrer" className="group flex flex-col items-center gap-3">
        <div
          className={`flex h-16 w-16 items-center justify-center rounded-2xl transition-opacity group-hover:opacity-80 ${meta.accent}`}
        >
          <Icon className="h-8 w-8" />
        </div>
        <span className="text-xs text-primary underline-offset-4 group-hover:underline">Open original</span>
      </a>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-[200px] items-center justify-center overflow-hidden bg-muted/30 px-4 py-6">
          {renderMedia()}
        </div>

        <div className="space-y-3 border-t p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-4">
          <div className="space-y-1">
            <div className="break-all text-sm font-medium">{item.filename}</div>
            <div className="text-xs text-muted-foreground">
              {item.uploaderName ? <span>{item.uploaderName} · </span> : null}
              {item.streamSlug ? (
                <>
                  <Hash className="mr-0.5 inline h-3 w-3 align-[-2px]" />
                  {item.streamSlug} ·{" "}
                </>
              ) : null}
              <span title={formatFull(new Date(item.createdAt))}>{formatFull(new Date(item.createdAt))}</span>
              <span> · {formatFileSize(item.sizeBytes)}</span>
            </div>
          </div>

          {item.extraction?.summary ? (
            <div className="space-y-1">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Extract</div>
              <p className="line-clamp-5 text-xs leading-relaxed text-foreground/80">
                {stripMarkdownToInline(item.extraction.summary)}
              </p>
            </div>
          ) : null}

          {item.referenceCount > 0 ? (
            <div className="text-xs text-muted-foreground">
              Referenced by {item.referenceCount} message{item.referenceCount === 1 ? "" : "s"}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            {sourceUrl ? (
              <Button size="sm" variant="outline" onClick={() => navigate(sourceUrl)} className="gap-1">
                <ExternalLink className="h-3.5 w-3.5" />
                Show message
              </Button>
            ) : null}
            {rawUrl ? (
              <Button size="sm" variant="ghost" asChild>
                <a href={rawUrl} download={item.filename} className="gap-1">
                  <Download className="h-3.5 w-3.5" />
                  {processedUrl ? "Original" : "Download"}
                </a>
              </Button>
            ) : null}
            {processedUrl ? (
              <Button size="sm" variant="ghost" asChild>
                <a href={processedUrl} download={item.filename.replace(/\.[^.]+$/, ".mp4")} className="gap-1">
                  <Download className="h-3.5 w-3.5" />
                  Processed (.mp4)
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
