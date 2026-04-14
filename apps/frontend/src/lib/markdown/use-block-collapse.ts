import { useCallback, useMemo } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/db"
import {
  composeBlockCollapseKey,
  hashMarkdownBlock,
  useMarkdownBlockContext,
  type MarkdownBlockKind,
} from "./markdown-block-context"

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
 * reloads without leaking between messages.
 */
export function useBlockCollapse({
  kind,
  hashNamespace = kind,
  content,
  defaultCollapsed,
}: UseBlockCollapseOptions): BlockCollapseState {
  const messageContext = useMarkdownBlockContext()

  const collapseKey = useMemo(() => {
    if (!messageContext) return null
    return composeBlockCollapseKey(messageContext.messageId, kind, hashMarkdownBlock(content, hashNamespace))
  }, [messageContext, kind, hashNamespace, content])

  const persistedOverride = useLiveQuery(async () => {
    if (!collapseKey) return undefined
    const row = await db.markdownBlockCollapse.get(collapseKey)
    return row?.collapsed
  }, [collapseKey])

  const collapsed = persistedOverride ?? defaultCollapsed

  const toggle = useCallback(() => {
    if (!collapseKey || !messageContext) return
    void db.markdownBlockCollapse.put({
      id: collapseKey,
      messageId: messageContext.messageId,
      kind,
      collapsed: !collapsed,
      updatedAt: Date.now(),
    })
  }, [collapseKey, messageContext, collapsed, kind])

  return {
    collapsed,
    canToggle: Boolean(collapseKey),
    toggle,
  }
}
