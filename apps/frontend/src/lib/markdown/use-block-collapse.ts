import { useCallback, useMemo } from "react"
import {
  composeBlockCollapseKey,
  hashMarkdownBlock,
  useIsInsideCollapsibleBlock,
  useMarkdownBlockContext,
  type MarkdownBlockKind,
} from "./markdown-block-context"
import { setBlockCollapse, useBlockCollapseStore } from "./collapse-cache"

export interface BlockCollapseState {
  collapsed: boolean
  /** True when a MarkdownBlockProvider is mounted so toggles can be persisted. */
  canToggle: boolean
  toggle: () => void
}

interface UseBlockCollapseOptions {
  kind: MarkdownBlockKind
  /**
   * Distinguishes otherwise-identical content within a single kind
   * (code uses `language`, quote-replies use `${streamId}/${messageId}`).
   * Defaults to `kind` when a block type has no secondary axis.
   */
  hashNamespace?: string
  content: string
  /** Starting collapse state when no persisted user override exists. */
  defaultCollapsed: boolean
}

/**
 * Shared collapse-state hook for collapsible markdown blocks. Persists
 * toggles per `(messageId, kind, contentHash)` in IDB so choices survive
 * reloads without leaking between messages. Reads are synchronous via the
 * shared `collapse-cache` so the first paint already reflects the persisted
 * state — preventing the timeline from resizing rows after mount.
 */
export function useBlockCollapse({
  kind,
  hashNamespace = kind,
  content,
  defaultCollapsed,
}: UseBlockCollapseOptions): BlockCollapseState {
  const messageContext = useMarkdownBlockContext()
  const nested = useIsInsideCollapsibleBlock()

  const collapseKey = useMemo(() => {
    if (!messageContext || nested) return null
    return composeBlockCollapseKey(messageContext.messageId, kind, hashMarkdownBlock(content, hashNamespace))
  }, [messageContext, nested, kind, hashNamespace, content])

  const persistedOverride = useBlockCollapseStore(collapseKey)

  // Nested blocks render plain (always expanded, no toggle) so only the
  // outermost foldable block folds.
  const collapsed = nested ? false : (persistedOverride ?? defaultCollapsed)

  const toggle = useCallback(() => {
    if (!collapseKey || !messageContext) return
    setBlockCollapse(collapseKey, messageContext.messageId, kind, !collapsed)
  }, [collapseKey, messageContext, collapsed, kind])

  return {
    collapsed,
    canToggle: Boolean(collapseKey),
    toggle,
  }
}
