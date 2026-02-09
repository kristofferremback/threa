import type { Stream, StreamType } from "./repository"

export type DisplayNameSource = "slug" | "generated" | "participants" | "placeholder"

export interface DisplayNameContext {
  parentStream?: { slug: string | null; displayName: string | null } | null
  participants?: { id: string; name: string }[]
  viewingUserId?: string
}

export interface EffectiveDisplayName {
  displayName: string
  source: DisplayNameSource
}

/**
 * Computes the effective display name for a stream based on its type:
 * - Channel: use slug directly
 * - DM: format participant names
 * - Scratchpad/Thread: use generated name or placeholder
 */
export function getEffectiveDisplayName(stream: Stream, context?: DisplayNameContext): EffectiveDisplayName {
  switch (stream.type) {
    case "channel":
      return {
        displayName: stream.slug ?? "unnamed-channel",
        source: "slug",
      }

    case "dm":
      if (context?.participants && context.viewingUserId) {
        return {
          displayName: formatParticipantNames(context.participants, context.viewingUserId),
          source: "participants",
        }
      }
      return {
        displayName: "Direct message",
        source: "placeholder",
      }

    case "thread":
      if (stream.displayName && stream.displayNameGeneratedAt) {
        return {
          displayName: stream.displayName,
          source: "generated",
        }
      }
      // Placeholder for threads without a generated name
      if (context?.parentStream) {
        const parentName = context.parentStream.slug ?? context.parentStream.displayName ?? "channel"
        return {
          displayName: `Thread in #${parentName}`,
          source: "placeholder",
        }
      }
      return {
        displayName: "New thread",
        source: "placeholder",
      }

    case "scratchpad":
      if (stream.displayName && stream.displayNameGeneratedAt) {
        return {
          displayName: stream.displayName,
          source: "generated",
        }
      }
      return {
        displayName: "New scratchpad",
        source: "placeholder",
      }

    default:
      return {
        displayName: stream.displayName ?? "Unnamed",
        source: stream.displayNameGeneratedAt ? "generated" : "placeholder",
      }
  }
}

/**
 * Formats participant names for DM display.
 * - 0 others: "Notes to self"
 * - 1 other: "Max"
 * - 2 others: "Max and Sam"
 * - 3+ others: "Max, Sam, and 2 others"
 */
export function formatParticipantNames(participants: { id: string; name: string }[], viewingUserId: string): string {
  const others = participants.filter((p) => p.id !== viewingUserId)

  if (others.length === 0) {
    return "Notes to self"
  }

  if (others.length === 1) {
    return others[0].name
  }

  if (others.length === 2) {
    return `${others[0].name} and ${others[1].name}`
  }

  // 3+ participants
  const remaining = others.length - 2
  return `${others[0].name}, ${others[1].name}, and ${remaining} ${remaining === 1 ? "other" : "others"}`
}

/**
 * Checks whether a stream needs auto-naming.
 * Returns true if:
 * - Stream is a scratchpad or thread
 * - Display name is not set (neither manually nor generated)
 */
export function needsAutoNaming(stream: Stream): boolean {
  if (stream.type !== "scratchpad" && stream.type !== "thread") {
    return false
  }
  return stream.displayName === null
}
