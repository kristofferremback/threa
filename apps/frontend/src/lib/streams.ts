import { StreamTypes } from "@threa/types"
import type { StreamType } from "@threa/types"

/**
 * Returns the resolved display name for a stream, or null if the stream
 * has no name yet (draft scratchpad, new thread, etc.).
 *
 * Channels use their slug prefixed with #.
 * DMs should arrive from bootstrap with displayName pre-resolved to participant names.
 * Threads/scratchpads use their AI-generated displayName or null for drafts.
 */
export function getStreamName(stream: {
  type: string
  slug?: string | null
  displayName?: string | null
}): string | null {
  if (stream.type === StreamTypes.CHANNEL) return stream.slug ? `#${stream.slug}` : null
  return stream.displayName ?? null
}

type FallbackContext = "sidebar" | "activity" | "breadcrumb" | "generic"

const FALLBACK_LABELS: Record<string, Record<FallbackContext, string>> = {
  scratchpad: { sidebar: "New scratchpad", activity: "a scratchpad", breadcrumb: "Untitled", generic: "Untitled" },
  thread: { sidebar: "New thread", activity: "a thread", breadcrumb: "Thread", generic: "Thread" },
  channel: { sidebar: "Untitled", activity: "a channel", breadcrumb: "...", generic: "Untitled" },
  dm: { sidebar: "Direct message", activity: "a conversation", breadcrumb: "DM", generic: "DM" },
  system: { sidebar: "System", activity: "system", breadcrumb: "System", generic: "System" },
}

/** Context-appropriate fallback text for streams that truly have no name yet. */
export function streamFallbackLabel(type: StreamType, context: FallbackContext): string {
  return FALLBACK_LABELS[type]?.[context] ?? "Untitled"
}
