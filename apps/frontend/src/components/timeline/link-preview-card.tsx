import { useState, useCallback } from "react"
import { ExternalLink, X, FileText, Image as ImageIcon, ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { LinkPreviewSummary } from "@threa/types"

interface LinkPreviewCardProps {
  preview: LinkPreviewSummary
  isHighlighted?: boolean
  isCollapsed?: boolean
  onDismiss?: (previewId: string) => void
  onToggleCollapse?: (previewId: string) => void
}

function ContentTypeIcon({ contentType }: { contentType: string }) {
  switch (contentType) {
    case "pdf":
      return <FileText className="h-4 w-4 text-red-500 shrink-0" />
    case "image":
      return <ImageIcon className="h-4 w-4 text-blue-500 shrink-0" />
    default:
      return <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
  }
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function LinkPreviewCard({
  preview,
  isHighlighted,
  isCollapsed: isCollapsedProp,
  onDismiss,
  onToggleCollapse,
}: LinkPreviewCardProps) {
  const [imageError, setImageError] = useState(false)
  const domain = getDomain(preview.url)

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDismiss?.(preview.id)
    },
    [onDismiss, preview.id]
  )

  const handleToggleCollapse = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onToggleCollapse?.(preview.id)
    },
    [onToggleCollapse, preview.id]
  )

  // Image-type previews render as a thumbnail
  if (preview.contentType === "image") {
    return (
      <a
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "group/preview relative block overflow-hidden rounded-lg border bg-muted/30 transition-all max-w-xs",
          "hover:border-primary hover:shadow-sm",
          isHighlighted && "ring-2 ring-primary border-primary shadow-sm"
        )}
      >
        <div className="absolute top-1.5 right-1.5 z-10 flex gap-1 opacity-0 group-hover/preview:opacity-100 transition-opacity">
          {onDismiss && (
            <Button
              variant="secondary"
              size="icon"
              className="h-6 w-6 shadow-sm"
              onClick={handleDismiss}
              aria-label="Dismiss preview"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        {!imageError ? (
          <img
            src={preview.url}
            alt={preview.title ?? "Image preview"}
            className="h-32 w-auto max-w-xs object-cover"
            loading="lazy"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="flex h-32 w-40 items-center justify-center text-muted-foreground">
            <ImageIcon className="h-8 w-8" />
          </div>
        )}
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{domain}</span>
        </div>
      </a>
    )
  }

  // Website and PDF previews render as a card
  return (
    <div
      className={cn(
        "group/preview relative overflow-hidden rounded-lg border bg-card transition-all max-w-md",
        "hover:border-primary/50 hover:shadow-sm",
        isHighlighted && "ring-2 ring-primary border-primary shadow-sm"
      )}
    >
      {/* Header with collapse/dismiss controls */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b bg-muted/30">
        <button
          type="button"
          onClick={handleToggleCollapse}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label={isCollapsedProp ? "Expand preview" : "Collapse preview"}
        >
          {isCollapsedProp ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        <ContentTypeIcon contentType={preview.contentType} />
        {preview.faviconUrl && (
          <img
            src={preview.faviconUrl}
            alt=""
            className="h-3.5 w-3.5 rounded-sm"
            loading="lazy"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = "none"
            }}
          />
        )}
        <span className="text-xs text-muted-foreground truncate">{preview.siteName ?? domain}</span>
        <ExternalLink className="h-3 w-3 text-muted-foreground/50 shrink-0 ml-auto" />
        <div className="flex gap-1 opacity-0 group-hover/preview:opacity-100 transition-opacity">
          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={handleDismiss}
              aria-label="Dismiss preview"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Expandable content */}
      {!isCollapsedProp && (
        <a
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex gap-3 p-3 hover:bg-muted/20 transition-colors"
        >
          <div className="flex-1 min-w-0">
            {preview.title && (
              <h4 className="text-sm font-medium text-foreground line-clamp-2 mb-0.5">{preview.title}</h4>
            )}
            {preview.description && <p className="text-xs text-muted-foreground line-clamp-2">{preview.description}</p>}
          </div>
          {preview.imageUrl && !imageError && (
            <img
              src={preview.imageUrl}
              alt=""
              className="h-16 w-24 rounded object-cover shrink-0"
              loading="lazy"
              onError={() => setImageError(true)}
            />
          )}
        </a>
      )}
    </div>
  )
}
