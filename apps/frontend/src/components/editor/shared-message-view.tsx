import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { X, Share2 } from "lucide-react"
import { useParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { useSharedMessageSource, type SharedMessageSource } from "@/hooks/use-shared-message-source"
import { stripMarkdownToInline } from "@/lib/markdown"
import type { SharedMessageAttrs } from "./shared-message-extension"

/**
 * Live pointer to a message in another stream. Resolves the preview content
 * from the server-provided hydration map first, falls back to the viewer's
 * local IndexedDB cache, and shows a staggered skeleton only if neither has
 * landed within the usual 300ms loading threshold.
 */
export function SharedMessageView({ node, deleteNode, selected }: NodeViewProps) {
  const attrs = node.attrs as SharedMessageAttrs
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const source = useSharedMessageSource(attrs.messageId, attrs.streamId)

  return (
    <NodeViewWrapper
      className={cn(
        "my-1 flex items-start gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm select-none",
        "group/shared-message",
        selected && "ring-2 ring-primary/30"
      )}
      data-type="shared-message"
    >
      <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">{renderBody(attrs, source, workspaceId)}</div>
      <button
        type="button"
        onClick={deleteNode}
        className="shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/shared-message:opacity-100"
        aria-label="Remove shared message"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </NodeViewWrapper>
  )
}

function renderBody(attrs: SharedMessageAttrs, source: SharedMessageSource, _workspaceId: string | undefined) {
  if (source.status === "deleted") {
    return (
      <>
        <AuthorLabel name={attrs.authorName || "—"} />
        <p className="mt-0.5 italic text-muted-foreground">Message deleted by author</p>
      </>
    )
  }

  if (source.status === "missing") {
    return (
      <>
        <AuthorLabel name={attrs.authorName || "—"} />
        <p className="mt-0.5 italic text-muted-foreground">Message no longer available</p>
      </>
    )
  }

  if (source.status === "pending") {
    return (
      <>
        <AuthorLabel name={attrs.authorName || "—"} />
        {source.showSkeleton ? (
          <Skeleton className="mt-1 h-3 w-48" />
        ) : (
          // Before the staggered-skeleton threshold, leave the body blank so
          // the common fast-path (content resolves within 300ms) doesn't flash
          // a loading state. The row still shows the author for layout stability.
          <p className="mt-0.5 h-3" aria-hidden="true" />
        )}
      </>
    )
  }

  // INV-60: preview surfaces must strip markdown before rendering.
  const snippet = stripMarkdownToInline(source.contentMarkdown)
  const display = snippet.length > 200 ? snippet.slice(0, 200) + "…" : snippet

  return (
    <>
      <AuthorLabel name={source.authorName || attrs.authorName || "—"} />
      <p className="mt-0.5 text-muted-foreground">{display}</p>
    </>
  )
}

function AuthorLabel({ name }: { name: string }) {
  return <span className="text-xs font-medium text-muted-foreground">{name}</span>
}
