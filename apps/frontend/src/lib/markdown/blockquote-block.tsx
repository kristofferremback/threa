import { useMemo, type ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { DEFAULT_BLOCKQUOTE_COLLAPSE_THRESHOLD } from "@threa/types"
import { cn } from "@/lib/utils"
import { usePreferencesOptional } from "@/contexts/preferences-context"
import { useBlockCollapse } from "./use-block-collapse"
import { extractBlockText, estimateBlockLines, takeQuotePreview, QUOTE_PREVIEW_LINE_COUNT } from "./extract-block-text"

interface BlockquoteBlockProps {
  children: ReactNode
}

export function BlockquoteBlock({ children }: BlockquoteBlockProps) {
  const text = useMemo(() => extractBlockText(children), [children])
  const lineCount = useMemo(() => estimateBlockLines(text), [text])

  const preferencesContext = usePreferencesOptional()
  const threshold =
    preferencesContext?.preferences?.blockquoteCollapseThreshold ?? DEFAULT_BLOCKQUOTE_COLLAPSE_THRESHOLD
  const defaultCollapsed = lineCount > threshold
  const hasTruncatedPreview = lineCount > QUOTE_PREVIEW_LINE_COUNT

  const { collapsed, canToggle, toggle } = useBlockCollapse({
    kind: "blockquote",
    content: text,
    defaultCollapsed,
  })

  // Rendered outside a message context (standalone previews, tests with no
  // provider): fall back to the plain bordered blockquote. Nothing to persist
  // to, and the collapse chrome would be dead UI.
  if (!canToggle) {
    return (
      <blockquote className="my-2 border-l-2 border-primary/50 pl-4 text-muted-foreground italic">
        {children}
      </blockquote>
    )
  }

  const previewText = collapsed && hasTruncatedPreview ? takeQuotePreview(text) : ""
  const toggleLabel = collapsed ? `Expand ${lineCount} line${lineCount === 1 ? "" : "s"}` : "Collapse block quote"
  const bodyTogglesExpand = collapsed && hasTruncatedPreview

  return (
    <blockquote className="my-2 rounded-r-md border-l-2 border-primary/50 bg-muted/20">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={toggleLabel}
        title={toggleLabel}
        className="flex w-full cursor-pointer items-center gap-1 px-3 py-1 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
        <span className="shrink-0">Quote</span>
        {collapsed && (
          <span className="text-muted-foreground/80 font-normal shrink-0">
            — {lineCount} line{lineCount === 1 ? "" : "s"}, click to expand
          </span>
        )}
      </button>
      {collapsed ? (
        <div
          className={cn("px-4 pb-2 text-sm text-muted-foreground italic", bodyTogglesExpand && "cursor-pointer")}
          onClick={bodyTogglesExpand ? toggle : undefined}
        >
          {hasTruncatedPreview ? <p className="mb-0 truncate">{previewText}</p> : children}
        </div>
      ) : (
        <div className="px-4 pb-2 text-muted-foreground italic">{children}</div>
      )}
    </blockquote>
  )
}
