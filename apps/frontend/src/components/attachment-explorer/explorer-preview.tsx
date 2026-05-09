import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { categoryFromMime } from "@threa/types"
import { Download, ExternalLink, Hash } from "lucide-react"
import { attachmentsApi, type AttachmentSearchItem } from "@/api/attachments"
import { Button } from "@/components/ui/button"
import { useFormattedDate } from "@/hooks"
import { CATEGORY_META } from "./category"
import { formatFileSize } from "./format"

interface ExplorerPreviewProps {
  workspaceId: string
  item: AttachmentSearchItem | null
}

export function ExplorerPreview({ workspaceId, item }: ExplorerPreviewProps) {
  const { formatFull } = useFormattedDate()
  const navigate = useNavigate()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    setPreviewUrl(null)
    setPreviewError(null)
    if (!item) return
    let cancelled = false
    attachmentsApi
      .getDownloadUrl(workspaceId, item.id, { variant: "raw" })
      .then((url) => {
        if (!cancelled) setPreviewUrl(url)
      })
      .catch((err) => {
        if (cancelled) return
        setPreviewError(err instanceof Error ? err.message : "Failed to load preview")
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, item])

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground">
        Select a file to preview it here.
      </div>
    )
  }

  const selected = item
  const category = categoryFromMime(selected.mimeType)
  const meta = CATEGORY_META[category]
  const Icon = meta.icon
  const sourceUrl =
    selected.streamId && selected.messageId ? `/w/${workspaceId}/s/${selected.streamId}?m=${selected.messageId}` : null

  function renderMedia() {
    if (previewError) {
      return <div className="px-6 py-4 text-xs text-muted-foreground">{previewError}</div>
    }
    if (!previewUrl) {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${meta.accent}`}>
            <Icon className="h-8 w-8" />
          </div>
        </div>
      )
    }
    if (category === "image") {
      return <img src={previewUrl} alt={selected.filename} className="max-h-full max-w-full object-contain" />
    }
    if (category === "video") {
      return <video src={previewUrl} controls className="max-h-full max-w-full" />
    }
    if (category === "audio") {
      return (
        <div className="w-full px-6">
          <audio src={previewUrl} controls className="w-full" />
        </div>
      )
    }
    return (
      <div className="flex flex-col items-center gap-3">
        <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${meta.accent}`}>
          <Icon className="h-8 w-8" />
        </div>
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary underline-offset-4 hover:underline"
        >
          Open original
        </a>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/30">{renderMedia()}</div>

      <div className="max-h-[55%] space-y-3 overflow-y-auto border-t p-4">
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
            <p className="line-clamp-5 text-xs leading-relaxed text-foreground/80">{item.extraction.summary}</p>
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
              Open in #{item.streamSlug ?? "stream"}
            </Button>
          ) : null}
          {previewUrl ? (
            <Button size="sm" variant="ghost" asChild>
              <a href={previewUrl} download={item.filename} className="gap-1">
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
