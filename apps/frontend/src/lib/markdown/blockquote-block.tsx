import { useMemo, type ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { DEFAULT_BLOCKQUOTE_COLLAPSE_THRESHOLD } from "@threa/types"
import { cn } from "@/lib/utils"
import { usePreferences } from "@/contexts/preferences-context"
import { useBlockCollapse } from "./use-block-collapse"
import { extractBlockText, estimateBlockLines, takeQuotePreview, QUOTE_PREVIEW_LINE_COUNT } from "./extract-block-text"

interface BlockquoteBlockProps {
  children: ReactNode
}

/**
 * Safe preferences accessor — mirrors CodeBlock so renderers without a
 * workspace/preferences provider (tests, standalone previews) fall back
 * to defaults instead of throwing.
 */
function usePreferencesOptional() {
  try {
    return usePreferences()
  } catch {
    return null
  }
}

/**
 * Collapsible blockquote. Long quotes start collapsed (per the user's
 * `blockquoteCollapseThreshold` preference) with a short plain-text preview;
 * clicking the header toggles between the full rendered blockquote and the
 * preview. Short quotes render expanded and are still manually collapsible.
 */
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
    hashNamespace: "blockquote",
    content: text,
    defaultCollapsed,
  })

  const previewText = useMemo(
    () => (collapsed && hasTruncatedPreview ? takeQuotePreview(text) : ""),
    [collapsed, hasTruncatedPreview, text]
  )

  const toggleLabel = collapsed ? `Expand ${lineCount} line${lineCount === 1 ? "" : "s"}` : "Collapse block quote"

  // Collapsed + truncated: clicking the preview body also expands.
  const bodyTogglesExpand = collapsed && canToggle && hasTruncatedPreview

  return (
    <blockquote className="my-2 rounded-r-md border-l-2 border-primary/50 bg-muted/20">
      <button
        type="button"
        onClick={toggle}
        disabled={!canToggle}
        aria-expanded={!collapsed}
        aria-label={toggleLabel}
        title={toggleLabel}
        className={cn(
          "flex w-full items-center gap-1 px-3 py-1 text-left",
          "text-[11px] font-medium text-muted-foreground",
          canToggle ? "hover:text-foreground cursor-pointer" : "cursor-default",
          "disabled:cursor-default"
        )}
      >
        {canToggle &&
          (collapsed ? (
            <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
          ))}
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
