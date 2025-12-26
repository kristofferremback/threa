import { useMemo } from "react"
import type { Mentionable } from "@/components/editor/triggers/types"
import { useWorkspaceBootstrap } from "./use-workspaces"
import { useParams } from "react-router-dom"

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
 * Combines users, personas, and broadcast options.
 */
export function useMentionables() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: bootstrap, isLoading } = useWorkspaceBootstrap(workspaceId ?? "")

  const mentionables = useMemo<Mentionable[]>(() => {
    if (!bootstrap) return BROADCAST_MENTIONS

    const users: Mentionable[] = bootstrap.users.map((user) => ({
      id: user.id,
      slug: user.slug,
      name: user.name,
      type: "user",
    }))

    const personas: Mentionable[] = bootstrap.personas.map((persona) => ({
      id: persona.id,
      slug: persona.slug,
      name: persona.name,
      type: "persona",
      avatarEmoji: persona.avatarEmoji ?? undefined,
    }))

    return [...users, ...personas, ...BROADCAST_MENTIONS]
  }, [bootstrap])

  return {
    mentionables,
    isLoading,
  }
}

/**
 * Filter mentionables by query string.
 * Matches against slug and name, case-insensitive.
 */
export function filterMentionables(items: Mentionable[], query: string): Mentionable[] {
  if (!query) return items

  const lowerQuery = query.toLowerCase()
  return items.filter(
    (item) => item.slug.toLowerCase().includes(lowerQuery) || item.name.toLowerCase().includes(lowerQuery)
  )
}
