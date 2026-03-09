import { useMemo } from "react"
import type { Mentionable } from "@/components/editor/triggers/types"
import { useWorkspaceBootstrap } from "./use-workspaces"
import { useParams } from "react-router-dom"
import { useUser } from "@/auth"
import { useWorkspaceEmoji } from "./use-workspace-emoji"
import { StreamTypes, type StreamType } from "@threa/types"

/**
 * Stream context for filtering which broadcast mentions are available.
 * `streamType` is the current stream's type; `rootStreamType` is the root
 * stream's type when the current stream is a thread.
 */
export interface MentionStreamContext {
  streamType: StreamType
  rootStreamType?: StreamType
}

/**
 * Reserved broadcast mention slugs.
 */
const BROADCAST_CHANNEL: Mentionable = {
  id: "broadcast:channel",
  slug: "channel",
  name: "Channel",
  type: "broadcast",
  avatarEmoji: "📢",
}

const BROADCAST_HERE: Mentionable = {
  id: "broadcast:here",
  slug: "here",
  name: "Here",
  type: "broadcast",
  avatarEmoji: "👋",
}

const ALL_BROADCAST_MENTIONS: Mentionable[] = [BROADCAST_CHANNEL, BROADCAST_HERE]

/**
 * Return the broadcast mentions allowed for a given stream context.
 *
 * @channel — channels and threads under channels
 * @here    — channels, DMs, and threads under either
 */
export function filterBroadcastMentions(ctx?: MentionStreamContext): Mentionable[] {
  if (!ctx) return ALL_BROADCAST_MENTIONS

  // For threads, use the root stream type to determine eligibility
  const effectiveType = ctx.rootStreamType ?? ctx.streamType

  const allowed: Mentionable[] = []

  // @channel: only in channel-tree streams
  if (effectiveType === StreamTypes.CHANNEL) {
    allowed.push(BROADCAST_CHANNEL)
  }

  // @here: channel-tree and DM-tree streams
  if (effectiveType === StreamTypes.CHANNEL || effectiveType === StreamTypes.DM) {
    allowed.push(BROADCAST_HERE)
  }

  return allowed
}

/**
 * Hook that provides mentionable entities for the current workspace.
 * Combines users, personas, broadcast options, and a special "me" shortcut.
 *
 * When `streamContext` is provided, broadcast mentions are filtered based on
 * stream type. Without it, all broadcasts are included (backwards-compatible).
 */
export function useMentionables(streamContext?: MentionStreamContext) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: bootstrap, isLoading } = useWorkspaceBootstrap(workspaceId ?? "")
  const currentUser = useUser()
  const { toEmoji } = useWorkspaceEmoji(workspaceId ?? "")

  const mentionables = useMemo<Mentionable[]>(() => {
    const broadcasts = filterBroadcastMentions(streamContext)
    if (!bootstrap) return broadcasts

    // Build user mentionables from workspace-scoped user profiles.
    const currentUserId = currentUser?.id
    const workspaceUsers = bootstrap.users
    const users: Mentionable[] = workspaceUsers.map((u) => ({
      id: u.id,
      slug: u.slug,
      name: u.name,
      type: "user",
      isCurrentUser: u.workosUserId === currentUserId,
    }))

    // Sort users so current user is first
    users.sort((a, b) => {
      if (a.isCurrentUser) return -1
      if (b.isCurrentUser) return 1
      return 0
    })

    const personas: Mentionable[] = bootstrap.personas.map((persona) => {
      // Convert shortcode to emoji (e.g., ":thread:" -> "🧵")
      const emoji = persona.avatarEmoji ? toEmoji(persona.avatarEmoji) : undefined
      return {
        id: persona.id,
        slug: persona.slug,
        name: persona.name,
        type: "persona",
        avatarEmoji: emoji ?? undefined,
      }
    })

    return [...users, ...personas, ...broadcasts]
  }, [bootstrap, currentUser?.id, toEmoji, streamContext])

  return {
    mentionables,
    isLoading,
  }
}

/**
 * Filter mentionables by query string.
 * Matches against slug and name, case-insensitive.
 * Special case: "me" matches the current user.
 */
export function filterMentionables(items: Mentionable[], query: string): Mentionable[] {
  if (!query) return items

  const lowerQuery = query.toLowerCase()

  // Special case: "me" should match the current user
  if (lowerQuery === "me") {
    const currentUser = items.find((item) => item.isCurrentUser)
    if (currentUser) return [currentUser]
  }

  return items.filter(
    (item) => item.slug.toLowerCase().includes(lowerQuery) || item.name.toLowerCase().includes(lowerQuery)
  )
}

/**
 * Filter mentionables for search context.
 * Excludes broadcast mentions (@channel, @here) since they don't make sense to search for.
 */
export function filterSearchMentionables(items: Mentionable[], query: string): Mentionable[] {
  // Filter out broadcast mentions first
  const searchableItems = items.filter((item) => item.type !== "broadcast")
  return filterMentionables(searchableItems, query)
}

/**
 * Filter to only users (no personas, no broadcasts).
 * Used for `in:` filter since you can only DM with users, not personas.
 */
export function filterUsersOnly(items: Mentionable[], query: string): Mentionable[] {
  const usersOnly = items.filter((item) => item.type === "user")
  return filterMentionables(usersOnly, query)
}
