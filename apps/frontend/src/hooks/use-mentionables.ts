import { useMemo } from "react"
import type { Mentionable } from "@/components/editor/triggers/types"
import { useWorkspaceBootstrap } from "./use-workspaces"
import { useParams } from "react-router-dom"
import { useUser } from "@/auth"
import { useWorkspaceEmoji } from "./use-workspace-emoji"

/**
 * Reserved broadcast mention slugs.
 */
const BROADCAST_MENTIONS: Mentionable[] = [
  {
    id: "broadcast:channel",
    slug: "channel",
    name: "Channel",
    type: "broadcast",
    avatarEmoji: "📢",
  },
  {
    id: "broadcast:here",
    slug: "here",
    name: "Here",
    type: "broadcast",
    avatarEmoji: "👋",
  },
]

/**
 * Hook that provides mentionable entities for the current workspace.
 * Combines users, personas, broadcast options, and a special "me" shortcut.
 */
export function useMentionables() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: bootstrap, isLoading } = useWorkspaceBootstrap(workspaceId ?? "")
  const currentUser = useUser()
  const { toEmoji } = useWorkspaceEmoji(workspaceId ?? "")

  const mentionables = useMemo<Mentionable[]>(() => {
    if (!bootstrap) return BROADCAST_MENTIONS

    // Mark current user with isCurrentUser flag and put them first
    const currentUserId = currentUser?.id
    const users: Mentionable[] = bootstrap.users.map((user) => ({
      id: user.id,
      slug: user.slug,
      name: user.name,
      type: "user",
      isCurrentUser: user.id === currentUserId,
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

    return [...users, ...personas, ...BROADCAST_MENTIONS]
  }, [bootstrap, currentUser?.id, toEmoji])

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
