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
  /** True when the block should render in its collapsed form. */
  collapsed: boolean
  /** True when the user has a provider mounted so we can persist toggles. */
  canToggle: boolean
  /** Flip the collapsed state and persist it to IDB. No-op when `canToggle` is false. */
  toggle: () => void
}

interface UseBlockCollapseOptions {
  /** Kind of markdown block — determines the IDB key namespace. */
  kind: MarkdownBlockKind
  /**
   * Stable, content-derived string used to identify this specific block
   * within a message. Code blocks pass `language`, blockquotes can pass
   * the kind literal, quote replies pass the quoted messageId.
   */
  hashNamespace: string
  /** The block's content used to compute a stable per-block hash. */
  content: string
  /** Whether the block should start collapsed when no persisted override exists. */
  defaultCollapsed: boolean
}

/**
 * Shared collapse-state hook for markdown block components.
 * Persists toggles per `(messageId, kind, contentHash)` in IDB so user
 * choices survive reloads without leaking between messages.
 */
export function useBlockCollapse({
  kind,
  hashNamespace,
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
    const next = !collapsed
    // Persisted row always wins over threshold default once a user acts.
    void db.markdownBlockCollapse.put({
      id: collapseKey,
      messageId: messageContext.messageId,
      kind,
      collapsed: next,
      updatedAt: Date.now(),
    })
  }, [collapseKey, messageContext, collapsed, kind])

  return {
    collapsed,
    canToggle: Boolean(collapseKey),
    toggle,
  }
}
