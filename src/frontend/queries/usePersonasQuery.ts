/**
 * Personas Query Hook
 *
 * Fetches agent personas for a workspace using TanStack Query.
 */

import { useQuery } from "@tanstack/react-query"
import { personaApi, type PersonaMetadata } from "../../shared/api/persona-api"

export const personaKeys = {
  all: ["personas"] as const,
  workspace: (workspaceId: string) => [...personaKeys.all, workspaceId] as const,
}

interface UsePersonasQueryOptions {
  workspaceId?: string
  enabled?: boolean
}

/**
 * Hook to fetch personas for a workspace.
 * Returns personas for @-mention suggestions in the chat input.
 */
export function usePersonasQuery({ workspaceId, enabled = true }: UsePersonasQueryOptions = {}) {
  const query = useQuery({
    queryKey: personaKeys.workspace(workspaceId || ""),
    queryFn: async () => {
      if (!workspaceId) return { personas: [] }
      return personaApi.listPersonas(workspaceId)
    },
    enabled: enabled && !!workspaceId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 24 * 60 * 60 * 1000, // 24 hours
  })

  return {
    personas: query.data?.personas ?? [],
    isLoading: query.isLoading,
    error: query.error ? query.error.message : null,
    refetch: query.refetch,
  }
}

export type { PersonaMetadata }
