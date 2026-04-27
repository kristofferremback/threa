import { StreamTypes } from "@threa/types"
import type { StreamType } from "@threa/types"
import { Bell, FileText, Hash, MessageSquare } from "lucide-react"
import type { ComponentType } from "react"

/**
 * Canonical icon for each stream type. Shared by the quick-switcher list
 * and the share-message picker so the visual vocabulary doesn't drift
 * between two surfaces that ultimately list the same streams.
 */
export const STREAM_ICONS: Record<StreamType, ComponentType<{ className?: string }>> = {
  [StreamTypes.SCRATCHPAD]: FileText,
  [StreamTypes.CHANNEL]: Hash,
  [StreamTypes.DM]: MessageSquare,
  [StreamTypes.THREAD]: MessageSquare,
  [StreamTypes.SYSTEM]: Bell,
}

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

/**
 * Resolves the display name for a DM stream from local workspace caches.
 *
 * DM display names are viewer-specific and only computed on the backend at
 * bootstrap time. Socket events (`stream:created`, `stream:updated`) carry the
 * raw DB row with `displayName: null`, which can overwrite IDB state before a
 * bootstrap refetch lands. Resolving from the peer user via `dmPeers` +
 * `workspaceUsers` keeps the UI correct regardless of what the cached
 * `stream.displayName` happens to contain.
 *
 * Returns null when the peer user cannot be resolved yet (caller should fall
 * back to whatever name it already has).
 */
export function resolveDmDisplayName(
  streamId: string,
  workspaceUsers: Array<{ id: string; name: string }>,
  dmPeers: Array<{ streamId: string; userId: string }>
): string | null {
  const peerUserId = dmPeers.find((peer) => peer.streamId === streamId)?.userId
  if (!peerUserId) return null
  return workspaceUsers.find((u) => u.id === peerUserId)?.name ?? null
}

type FallbackContext = "sidebar" | "activity" | "breadcrumb" | "generic" | "noun"

const FALLBACK_LABELS: Record<string, Record<FallbackContext, string>> = {
  scratchpad: {
    sidebar: "New scratchpad",
    activity: "a scratchpad",
    breadcrumb: "Untitled",
    generic: "Untitled",
    noun: "scratchpad",
  },
  thread: { sidebar: "New thread", activity: "a thread", breadcrumb: "Thread", generic: "Thread", noun: "thread" },
  channel: { sidebar: "Untitled", activity: "a channel", breadcrumb: "...", generic: "Untitled", noun: "channel" },
  dm: { sidebar: "Direct message", activity: "a conversation", breadcrumb: "DM", generic: "DM", noun: "DM" },
  system: { sidebar: "System", activity: "system", breadcrumb: "System", generic: "System", noun: "system stream" },
}

/** Context-appropriate fallback text for streams that truly have no name yet. */
export function streamFallbackLabel(type: StreamType, context: FallbackContext): string {
  return FALLBACK_LABELS[type]?.[context] ?? "Untitled"
}
