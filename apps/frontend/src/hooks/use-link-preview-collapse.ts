import { useCallback } from "react"
import { setLinkPreviewExpand, useLinkPreviewExpandStore } from "@/lib/markdown/collapse-cache"

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
 * Reads are synchronous via the shared `collapse-cache` so the first paint
 * already reflects the persisted state — important inside the timeline so
 * Virtuoso doesn't see preview cards resize after mount.
 *
 * A missing `messageId` (e.g. tests or transient render contexts) disables
 * persistence — toggles become no-ops and `canToggle` reports false.
 */
export function useLinkPreviewCollapse(messageId: string | undefined, previewId: string): LinkPreviewCollapseState {
  const id = messageId ? `${messageId}:${previewId}` : null

  const persistedOverride = useLinkPreviewExpandStore(id)

  const expanded = persistedOverride ?? false

  const toggle = useCallback(() => {
    if (!id || !messageId) return
    setLinkPreviewExpand(id, messageId, previewId, !expanded)
  }, [id, messageId, previewId, expanded])

  return {
    expanded,
    canToggle: Boolean(id),
    toggle,
  }
}
