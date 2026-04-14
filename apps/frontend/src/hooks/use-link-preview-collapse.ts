import { useCallback } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/db"

export interface LinkPreviewCollapseState {
  expanded: boolean
  /** True once a valid scope is available so toggles can be persisted. */
  canToggle: boolean
  toggle: () => void
}

/**
 * Persists the "Show more" state of a link preview card per `(messageId,
 * previewId)` in IDB so user choices survive reloads without leaking across
 * messages. Mirrors the pattern used by `useBlockCollapse` for collapsible
 * markdown blocks.
 *
 * A missing `messageId` (e.g. tests or transient render contexts) disables
 * persistence — toggles become no-ops and `canToggle` reports false.
 */
export function useLinkPreviewCollapse(messageId: string | undefined, previewId: string): LinkPreviewCollapseState {
  const id = messageId ? `${messageId}:${previewId}` : null

  const persistedOverride = useLiveQuery(async () => {
    if (!id) return undefined
    const row = await db.linkPreviewCollapse.get(id)
    return row?.expanded
  }, [id])

  const expanded = persistedOverride ?? false

  const toggle = useCallback(() => {
    if (!id || !messageId) return
    void db.linkPreviewCollapse.put({
      id,
      messageId,
      previewId,
      expanded: !expanded,
      updatedAt: Date.now(),
    })
  }, [id, messageId, previewId, expanded])

  return {
    expanded,
    canToggle: Boolean(id),
    toggle,
  }
}
