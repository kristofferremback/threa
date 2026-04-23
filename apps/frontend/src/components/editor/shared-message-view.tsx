import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { X, Share2 } from "lucide-react"
import { useParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import { useSharedMessageHydration } from "@/components/shared-messages/context"
import type { SharedMessageAttrs } from "./shared-message-extension"

/**
 * Live pointer to a message in another stream. Displays hydrated content
 * from the shared-messages map provided by the timeline's context; falls
 * back to a skeleton with the cached author name when hydration hasn't
 * landed yet.
 */
export function SharedMessageView({ node, deleteNode, selected }: NodeViewProps) {
  const attrs = node.attrs as SharedMessageAttrs
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const hydrated = useSharedMessageHydration(attrs.messageId)

  const body = renderBody(attrs, hydrated, workspaceId)

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
      <div className="min-w-0 flex-1">{body}</div>
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

function renderBody(
  attrs: SharedMessageAttrs,
  hydrated: ReturnType<typeof useSharedMessageHydration>,
  _workspaceId: string | undefined
) {
  if (!hydrated || hydrated.state === "pending") {
    // Pre-hydration: show the author name cached on the node so the row
    // never renders completely blank on first paint.
    return (
      <>
        <AuthorLabel name={attrs.authorName || "…"} />
        <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground/60">Loading shared message…</p>
      </>
    )
  }

  if (hydrated.state === "deleted") {
    return (
      <>
        <AuthorLabel name={attrs.authorName || "—"} />
        <p className="mt-0.5 italic text-muted-foreground">Message deleted by author</p>
      </>
    )
  }

  if (hydrated.state === "missing") {
    return (
      <>
        <AuthorLabel name={attrs.authorName || "—"} />
        <p className="mt-0.5 italic text-muted-foreground">Message no longer available</p>
      </>
    )
  }

  const snippet = hydrated.contentMarkdown
  const lines = snippet.split("\n")
  const isLong = lines.length > 3 || snippet.length > 200
  const display = isLong ? lines.slice(0, 3).join("\n").slice(0, 200) + "…" : snippet

  return (
    <>
      <AuthorLabel name={hydrated.authorName || attrs.authorName} />
      <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{display}</p>
    </>
  )
}

function AuthorLabel({ name }: { name: string }) {
  return <span className="text-xs font-medium text-muted-foreground">{name}</span>
}
