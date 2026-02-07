import { useCallback, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { workspaceKeys } from "./use-workspaces"
import { useWorkspaceEmoji } from "./use-workspace-emoji"
import type { User, Persona, WorkspaceBootstrap, WorkspaceMember, AuthorType } from "@threa/types"

interface ActorAvatarInfo {
  fallback: string
  slug?: string
}

interface ActorLookup {
  getActorName: (actorId: string | null, actorType: AuthorType | null) => string
  getActorInitials: (actorId: string | null, actorType: AuthorType | null) => string
  /** Returns avatar info including fallback text and persona slug (for SVG icon support) */
  getActorAvatar: (actorId: string | null, actorType: AuthorType | null) => ActorAvatarInfo
  getMember: (memberId: string) => WorkspaceMember | undefined
  getUser: (userId: string) => User | undefined
  getPersona: (personaId: string) => Persona | undefined
}

/**
 * Resolve display name for a member ID.
 * Looks up the member's userId, then finds the user's name.
 */
function resolveMemberName(
  memberId: string,
  members: WorkspaceMember[] | undefined,
  users: User[] | undefined
): string | undefined {
  const member = members?.find((m) => m.id === memberId)
  if (!member) return undefined
  const user = users?.find((u) => u.id === member.userId)
  return user?.name
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

  const getMember = useCallback(
    (memberId: string): WorkspaceMember | undefined => {
      const bootstrap = getBootstrapData()
      return bootstrap?.members?.find((m) => m.id === memberId)
    },
    [getBootstrapData]
  )

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

      // actorType === "member" — resolve member → user for display name
      const bootstrap = getBootstrapData()
      const name = resolveMemberName(actorId, bootstrap?.members, bootstrap?.users)
      return name ?? actorId.substring(0, 8)
    },
    [getBootstrapData, getPersona]
  )

  const getActorInitials = useCallback(
    (actorId: string | null, actorType: AuthorType | null): string => {
      if (!actorId) return "?"

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

      const bootstrap = getBootstrapData()
      const name = resolveMemberName(actorId, bootstrap?.members, bootstrap?.users)
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
    [getBootstrapData, getPersona, toEmoji]
  )

  const getActorAvatar = useCallback(
    (actorId: string | null, actorType: AuthorType | null): ActorAvatarInfo => {
      const fallback = getActorInitials(actorId, actorType)

      if (actorType === "persona" && actorId) {
        const persona = getPersona(actorId)
        return { fallback, slug: persona?.slug }
      }

      return { fallback }
    },
    [getActorInitials, getPersona]
  )

  return useMemo(
    () => ({
      getActorName,
      getActorInitials,
      getActorAvatar,
      getMember,
      getUser,
      getPersona,
    }),
    [getActorName, getActorInitials, getActorAvatar, getMember, getUser, getPersona]
  )
}
