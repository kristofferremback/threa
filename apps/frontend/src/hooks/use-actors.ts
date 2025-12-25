import { useCallback, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { workspaceKeys } from "./use-workspaces"
import { toEmoji } from "@/lib/emoji"
import type { User, Persona, WorkspaceBootstrap, AuthorType } from "@threa/types"

interface ActorLookup {
  getActorName: (actorId: string | null, actorType: AuthorType | null) => string
  getActorInitials: (actorId: string | null, actorType: AuthorType | null) => string
  getUser: (userId: string) => User | undefined
  getPersona: (personaId: string) => Persona | undefined
}

/**
 * Hook to look up actor names from cached workspace data.
 * Uses React Query cache for synchronous lookups.
 */
export function useActors(workspaceId: string): ActorLookup {
  const queryClient = useQueryClient()

  const getBootstrapData = useCallback(() => {
    return queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId))
  }, [queryClient, workspaceId])

  const getUser = useCallback(
    (userId: string): User | undefined => {
      const bootstrap = getBootstrapData()
      return bootstrap?.users?.find((u) => u.id === userId)
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

  const getActorName = useCallback(
    (actorId: string | null, actorType: AuthorType | null): string => {
      if (!actorId) return "Unknown"

      if (actorType === "persona") {
        const persona = getPersona(actorId)
        return persona?.name ?? "AI Companion"
      }

      const user = getUser(actorId)
      return user?.name ?? actorId.substring(0, 8)
    },
    [getUser, getPersona]
  )

  const getActorInitials = useCallback(
    (actorId: string | null, actorType: AuthorType | null): string => {
      if (!actorId) return "?"

      if (actorType === "persona") {
        const persona = getPersona(actorId)
        if (persona?.avatarEmoji) {
          // Convert shortcode to emoji (e.g., ":thread:" -> "🧵")
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

      const user = getUser(actorId)
      if (user?.name) {
        const words = user.name.split(" ")
        return words
          .slice(0, 2)
          .map((w) => w[0])
          .join("")
          .toUpperCase()
      }

      return actorId.substring(0, 2).toUpperCase()
    },
    [getUser, getPersona]
  )

  return useMemo(
    () => ({
      getActorName,
      getActorInitials,
      getUser,
      getPersona,
    }),
    [getActorName, getActorInitials, getUser, getPersona]
  )
}
