import { useCallback, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { getAvatarUrl } from "@threa/types"
import { workspaceKeys } from "./use-workspaces"
import { useWorkspaceEmoji } from "./use-workspace-emoji"
import type { Persona, Bot, WorkspaceBootstrap, User, AuthorType } from "@threa/types"

interface ActorAvatarInfo {
  fallback: string
  slug?: string
  avatarUrl?: string
}

interface ActorLookup {
  getActorName: (actorId: string | null, actorType: AuthorType | null) => string
  getActorInitials: (actorId: string | null, actorType: AuthorType | null) => string
  /** Returns avatar info including fallback text and persona slug (for SVG icon support) */
  getActorAvatar: (actorId: string | null, actorType: AuthorType | null) => ActorAvatarInfo
  getUser: (userId: string) => User | undefined
  getPersona: (personaId: string) => Persona | undefined
  getBot: (botId: string) => Bot | undefined
}

/**
 * Resolve display name for a user ID.
 * Uses the workspace-scoped name stored on the user record.
 */
function resolveUserName(userId: string, users: User[] | undefined): string | undefined {
  const workspaceUser = users?.find((u) => u.id === userId)
  return workspaceUser?.name || undefined
}

/**
 * Hook to look up actor names from cached workspace data.
 * Uses React Query cache for synchronous lookups.
 */
export function useActors(workspaceId: string): ActorLookup {
  const queryClient = useQueryClient()
  const { toEmoji } = useWorkspaceEmoji(workspaceId)

  const getBootstrapData = useCallback(() => {
    return queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId))
  }, [queryClient, workspaceId])

  const getUser = useCallback(
    (userId: string): User | undefined => {
      const bootstrap = getBootstrapData()
      const users = bootstrap?.users ?? []
      return users.find((u) => u.id === userId)
    },
    [getBootstrapData]
  )

  const getPersona = useCallback(
    (personaId: string): Persona | undefined => {
      const bootstrap = getBootstrapData()
      return bootstrap?.personas?.find((p) => p.id === personaId)
    },
    [getBootstrapData]
  )

  const getBot = useCallback(
    (botId: string): Bot | undefined => {
      const bootstrap = getBootstrapData()
      return bootstrap?.bots?.find((b) => b.id === botId)
    },
    [getBootstrapData]
  )

  const getActorName = useCallback(
    (actorId: string | null, actorType: AuthorType | null): string => {
      if (!actorId) return "Unknown"

      if (actorType === "system") return "Threa"

      if (actorType === "persona") {
        const persona = getPersona(actorId)
        return persona?.name ?? "AI Companion"
      }

      if (actorType === "bot") {
        const bot = getBot(actorId)
        return bot?.name ?? "Bot"
      }

      // actorType === "user" — resolve workspace-scoped name
      const bootstrap = getBootstrapData()
      const users = bootstrap?.users
      const name = resolveUserName(actorId, users)
      return name ?? actorId.substring(0, 8)
    },
    [getBootstrapData, getPersona, getBot]
  )

  const getActorInitials = useCallback(
    (actorId: string | null, actorType: AuthorType | null): string => {
      if (!actorId) return "?"

      if (actorType === "system") return "T"

      if (actorType === "persona") {
        const persona = getPersona(actorId)
        if (persona?.avatarEmoji) {
          const emoji = toEmoji(persona.avatarEmoji)
          if (emoji) return emoji
        }
        if (persona?.name) {
          const words = persona.name.split(" ")
          return words
            .slice(0, 2)
            .map((w) => w[0])
            .join("")
            .toUpperCase()
        }
        return "AI"
      }

      if (actorType === "bot") {
        const bot = getBot(actorId)
        if (bot?.avatarEmoji) {
          const emoji = toEmoji(bot.avatarEmoji)
          if (emoji) return emoji
        }
        if (bot?.name) {
          const words = bot.name.split(" ")
          return words
            .slice(0, 2)
            .map((w) => w[0])
            .join("")
            .toUpperCase()
        }
        return "B"
      }

      const bootstrap = getBootstrapData()
      const users = bootstrap?.users
      const name = resolveUserName(actorId, users)
      if (name) {
        const words = name.split(" ")
        return words
          .slice(0, 2)
          .map((w) => w[0])
          .join("")
          .toUpperCase()
      }

      return actorId.substring(0, 2).toUpperCase()
    },
    [getBootstrapData, getPersona, getBot, toEmoji]
  )

  const getActorAvatar = useCallback(
    (actorId: string | null, actorType: AuthorType | null): ActorAvatarInfo => {
      const fallback = getActorInitials(actorId, actorType)

      if (actorType === "system") return { fallback }

      if (actorType === "persona" && actorId) {
        const persona = getPersona(actorId)
        return { fallback, slug: persona?.slug }
      }

      if (actorType === "bot") return { fallback }

      if (actorId) {
        const workspaceUser = getUser(actorId)
        const avatarUrl = getAvatarUrl(workspaceId, workspaceUser?.avatarUrl, 64)
        if (avatarUrl) return { fallback, avatarUrl }
      }

      return { fallback }
    },
    [getActorInitials, getPersona, getUser]
  )

  return useMemo(
    () => ({
      getActorName,
      getActorInitials,
      getActorAvatar,
      getUser,
      getPersona,
      getBot,
    }),
    [getActorName, getActorInitials, getActorAvatar, getUser, getPersona, getBot]
  )
}
