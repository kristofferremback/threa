import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { Loader2, MessageSquareReply, AlertCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { ContextRefChipAttrs } from "./context-ref-chip-extension"

function getDisplayLabel(attrs: ContextRefChipAttrs): string {
  if (attrs.status === "pending") return "Loading context…"
  if (attrs.status === "error") return "Context failed"
  return attrs.label || "Context"
}

function getTooltipBody(attrs: ContextRefChipAttrs): string | null {
  if (attrs.status === "error") return attrs.errorMessage || "Failed to load context"
  if (attrs.status === "ready") return `${attrs.label} — summary cached, first reply will be fast`
  if (attrs.status === "inline") return `${attrs.label} — short enough to inline directly`
  return null
}

export function ContextRefChipView({ node }: NodeViewProps) {
  const attrs = node.attrs as ContextRefChipAttrs
  const displayLabel = getDisplayLabel(attrs)
  const tooltipBody = getTooltipBody(attrs)

  let Icon = MessageSquareReply
  if (attrs.status === "pending") Icon = Loader2
  else if (attrs.status === "error") Icon = AlertCircle

  const baseStyles = cn(
    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-sm",
    "cursor-default select-none transition-colors"
  )

  const statusStyles: Record<ContextRefChipAttrs["status"], string> = {
    pending: "bg-muted/50 text-muted-foreground animate-pulse",
    ready: cn(
      "bg-primary/10 text-primary hover:bg-primary/20",
      "dark:bg-primary/20 dark:text-primary dark:hover:bg-primary/30"
    ),
    inline: cn(
      "bg-primary/10 text-primary hover:bg-primary/20",
      "dark:bg-primary/20 dark:text-primary dark:hover:bg-primary/30"
    ),
    error: "bg-destructive/10 text-destructive hover:bg-destructive/20",
  }

  const content = (
    <NodeViewWrapper
      as="span"
      className={cn(baseStyles, statusStyles[attrs.status])}
      data-type="context-ref-chip"
      data-status={attrs.status}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", attrs.status === "pending" && "animate-spin")} />
      <span className="truncate max-w-[180px]">[{displayLabel}]</span>
    </NodeViewWrapper>
  )

  if (!tooltipBody) return content

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px]">
          <p className="text-sm">{tooltipBody}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
