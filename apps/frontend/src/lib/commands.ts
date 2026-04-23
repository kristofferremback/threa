/**
 * Command utilities for slash command detection.
 *
 * A message is treated as a command only when the ProseMirror content contains
 * a dedicated slash command node, mirroring how mentions, channels, and emojis
 * are represented as structural nodes rather than raw text matches.
 */

import type { JSONContent } from "@threa/types"

/**
 * Returns true if the content contains a `slashCommand` node.
 *
 * We intentionally do not treat raw text like "/s" as a command — commands
 * must be materialized as nodes by the editor's slash trigger.
 */
export function hasCommandNode(content: JSONContent): boolean {
  if (content.type === "slashCommand") return true
  for (const child of content.content ?? []) {
    if (hasCommandNode(child)) return true
  }
  return false
}

/**
 * Extract the command name from the first `slashCommand` node in the content,
 * or null if none is present. Used by the composer to route command messages
 * — client-action commands (e.g. `discuss-with-ariadne`) are handled locally,
 * server commands are dispatched through `commandsApi.dispatch`.
 */
export function extractCommandName(content: JSONContent): string | null {
  if (content.type === "slashCommand") {
    const name = content.attrs?.name
    return typeof name === "string" ? name : null
  }
  for (const child of content.content ?? []) {
    const name = extractCommandName(child)
    if (name !== null) return name
  }
  return null
}
