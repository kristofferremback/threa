import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { X, Quote } from "lucide-react"
import { cn } from "@/lib/utils"
import type { QuoteReplyAttrs } from "./quote-reply-extension"

export function QuoteReplyView({ node, deleteNode, selected }: NodeViewProps) {
  const attrs = node.attrs as QuoteReplyAttrs
  const snippetLines = attrs.snippet.split("\n")
  const isLong = snippetLines.length > 3 || attrs.snippet.length > 200
  const displaySnippet = isLong ? snippetLines.slice(0, 3).join("\n").slice(0, 200) + "..." : attrs.snippet

  return (
    <NodeViewWrapper
      className={cn(
        "my-1 flex items-start gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm select-none",
        "group/quote-reply",
        selected && "ring-2 ring-primary/30"
      )}
      data-type="quote-reply"
    >
      <Quote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-muted-foreground">{attrs.authorName}</span>
        <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{displaySnippet}</p>
      </div>
      <button
        type="button"
        onClick={deleteNode}
        className="shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/quote-reply:opacity-100"
        aria-label="Remove quote"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </NodeViewWrapper>
  )
}
