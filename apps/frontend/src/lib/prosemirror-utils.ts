import type { JSONContent } from "@threa/types"

/**
 * Canonical empty ProseMirror document — one empty paragraph, which is the
 * shape TipTap settles on after clearing. Module-level so the reference is
 * stable across renders (no `useMemo` needed in callers). Also the natural
 * pair for `isEmptyContent`, which would return `true` for this value.
 *
 * Do not mutate.
 */
export const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }

/**
 * Check if ProseMirror JSONContent is effectively empty (only contains empty paragraphs).
 *
 * Used to determine whether a draft message should be deleted or shown in the drafts view.
 */
export function isEmptyContent(contentJson: JSONContent | undefined): boolean {
  if (!contentJson) return true
  if (!contentJson.content) return true
  return contentJson.content.every((node) => node.type === "paragraph" && (!node.content || node.content.length === 0))
}
