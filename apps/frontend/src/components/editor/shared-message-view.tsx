import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { X, Share2 } from "lucide-react"
import { useParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import { useSharedMessageSource } from "@/hooks/use-shared-message-source"
import { SharedMessageCardBody } from "@/components/shared-messages/card-body"
import type { SharedMessageAttrs } from "./shared-message-extension"

/**
 * Live pointer to a message in another stream. Resolves the preview content
 * from the server-provided hydration map first, falls back to the viewer's
 * local IndexedDB cache, and shows a staggered skeleton only if neither has
 * landed within the usual 300ms loading threshold.
 *
 * The body / status rendering is shared with `SharedMessagePointerBlock`
 * (the markdown-renderer counterpart) via `SharedMessageCardBody`. This
 * file only owns the NodeView frame: wrapper styling, the trailing
 * remove-button, and selection highlighting — not the per-state body
 * rendering.
 */
export function SharedMessageView({ node, deleteNode, selected }: NodeViewProps) {
  const attrs = node.attrs as SharedMessageAttrs
  const { workspaceId: _workspaceId } = useParams<{ workspaceId: string }>()
  const source = useSharedMessageSource(attrs.messageId, attrs.streamId)

  return (
    <NodeViewWrapper
      className={cn(
        "my-1 flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm select-none",
        "group/shared-message",
        selected && "ring-2 ring-primary/30"
      )}
      data-type="shared-message"
    >
      <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <SharedMessageCardBody source={source} fallbackAuthor={attrs.authorName ?? ""} />
      </div>
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
