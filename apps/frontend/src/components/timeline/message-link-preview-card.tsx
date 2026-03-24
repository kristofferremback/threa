import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { MessageSquare, Lock, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { linkPreviewsApi } from "@/api"
import type { LinkPreviewSummary, MessageLinkPreviewData } from "@threa/types"

interface MessageLinkPreviewCardProps {
  preview: LinkPreviewSummary
  workspaceId: string
  onDismiss?: (previewId: string) => void
}

export function MessageLinkPreviewCard({ preview, workspaceId, onDismiss }: MessageLinkPreviewCardProps) {
  const [data, setData] = useState<MessageLinkPreviewData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    linkPreviewsApi
      .resolveMessageLink(workspaceId, preview.id)
      .then((result) => {
        if (mounted) setData(result)
      })
      .catch(() => {
        // Silently fail — previews are non-critical
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [workspaceId, preview.id])

  if (loading) {
    return (
      <div className="rounded-lg border bg-card max-w-md animate-pulse">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="h-4 w-4 rounded bg-muted" />
          <div className="h-3 w-32 rounded bg-muted" />
        </div>
      </div>
    )
  }

  if (!data) return null

  if (data.accessTier === "cross_workspace") {
    return <CrossWorkspaceCard preview={preview} onDismiss={onDismiss} />
  }

  if (data.accessTier === "private") {
    return <PrivateMessageCard preview={preview} onDismiss={onDismiss} />
  }

  // Full access tier
  if (data.deleted) {
    return (
      <div className="group/preview relative overflow-hidden rounded-lg border bg-card max-w-md">
        <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
          <MessageSquare className="h-4 w-4 shrink-0" />
          <span className="text-xs italic">This message was deleted</span>
          <DismissButton previewId={preview.id} onDismiss={onDismiss} />
        </div>
      </div>
    )
  }

  return (
    <div className="group/preview relative overflow-hidden rounded-lg border bg-card transition-all max-w-md hover:border-primary/50 hover:shadow-sm">
      <Link to={preview.url.replace(window.location.origin, "")} className="block">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30">
          <MessageSquare className="h-4 w-4 text-primary shrink-0" />
          {data.streamName && <span className="text-xs text-muted-foreground truncate">#{data.streamName}</span>}
          <DismissButton previewId={preview.id} onDismiss={onDismiss} />
        </div>
        <div className="flex gap-2.5 px-3 py-2">
          <AuthorAvatar avatarUrl={data.authorAvatarUrl} authorName={data.authorName} />
          <div className="flex-1 min-w-0">
            {data.authorName && <span className="text-xs font-medium text-foreground">{data.authorName}</span>}
            {data.contentPreview && (
              <p className="text-xs text-muted-foreground line-clamp-3 mt-0.5">{data.contentPreview}</p>
            )}
          </div>
        </div>
      </Link>
    </div>
  )
}

function AuthorAvatar({ avatarUrl, authorName }: { avatarUrl?: string; authorName?: string }) {
  if (avatarUrl) {
    return (
      <Avatar className="h-5 w-5 shrink-0 mt-0.5">
        <AvatarImage src={avatarUrl} alt={authorName ?? ""} />
        <AvatarFallback className="text-[10px]">{authorName?.charAt(0)?.toUpperCase() ?? "?"}</AvatarFallback>
      </Avatar>
    )
  }

  if (authorName) {
    return (
      <Avatar className="h-5 w-5 shrink-0 mt-0.5">
        <AvatarFallback className="text-[10px]">{authorName.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
    )
  }

  return null
}

function PrivateMessageCard({
  preview,
  onDismiss,
}: {
  preview: LinkPreviewSummary
  onDismiss?: (previewId: string) => void
}) {
  return (
    <div className="group/preview relative overflow-hidden rounded-lg border bg-card max-w-md">
      <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
        <Lock className="h-4 w-4 shrink-0" />
        <span className="text-xs">Message in a private conversation</span>
        <DismissButton previewId={preview.id} onDismiss={onDismiss} />
      </div>
    </div>
  )
}

function CrossWorkspaceCard({
  preview,
  onDismiss,
}: {
  preview: LinkPreviewSummary
  onDismiss?: (previewId: string) => void
}) {
  return (
    <div className="group/preview relative overflow-hidden rounded-lg border bg-card max-w-md">
      <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
        <MessageSquare className="h-4 w-4 shrink-0" />
        <span className="text-xs">A message in Threa</span>
        <DismissButton previewId={preview.id} onDismiss={onDismiss} />
      </div>
    </div>
  )
}

function DismissButton({ previewId, onDismiss }: { previewId: string; onDismiss?: (previewId: string) => void }) {
  if (!onDismiss) return null

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-5 w-5 ml-auto opacity-0 group-hover/preview:opacity-100 transition-opacity"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDismiss(previewId)
      }}
      aria-label="Dismiss preview"
    >
      <X className="h-3 w-3" />
    </Button>
  )
}
