import type { JSONContent } from "@threa/types"

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
