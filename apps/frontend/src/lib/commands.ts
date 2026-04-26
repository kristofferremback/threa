/**
 * Command utilities for slash command detection.
 *
 * A message is treated as a command only when the ProseMirror content contains
 * a dedicated slash command node, mirroring how mentions, channels, and emojis
 * are represented as structural nodes rather than raw text matches. Raw text
 * like "/s" is NOT a command — nodes must be materialized by the editor's
 * slash trigger.
 */

import type { JSONContent } from "@threa/types"

export interface ExtractedCommand {
  name: string
  /**
   * Opaque discriminator for client-action commands. When non-null the
   * composer handles the command locally (e.g. `/discuss-with-ariadne`)
   * instead of dispatching to `commandsApi`. Persisted on the node at pick
   * time via `CommandExtension.mapPropsToAttrs` so the composer doesn't
   * have to maintain a list of per-`name` client-action switches.
   */
  clientActionId: string | null
}

/**
 * Walk the content tree and return the first `slashCommand` node's attrs as
 * `{ name, clientActionId }`, or null when no command node is present.
 * Single traversal — a null result is the complete "no command here"
 * signal, so there's no need for a separate presence check.
 */
export function extractCommandNode(content: JSONContent): ExtractedCommand | null {
  if (content.type === "slashCommand") {
    const name = content.attrs?.name
    if (typeof name !== "string") return null
    const clientActionId = content.attrs?.clientActionId
    return {
      name,
      clientActionId: typeof clientActionId === "string" ? clientActionId : null,
    }
  }
  for (const child of content.content ?? []) {
    const found = extractCommandNode(child)
    if (found !== null) return found
  }
  return null
}
