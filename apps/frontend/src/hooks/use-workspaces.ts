import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useWorkspaceService } from "@/contexts"
import { db } from "@/db"
import type { Workspace } from "@/types/domain"

// Query keys for cache management
export const workspaceKeys = {
  all: ["workspaces"] as const,
  lists: () => [...workspaceKeys.all, "list"] as const,
  list: () => [...workspaceKeys.lists()] as const,
  details: () => [...workspaceKeys.all, "detail"] as const,
  detail: (id: string) => [...workspaceKeys.details(), id] as const,
  bootstrap: (id: string) => [...workspaceKeys.all, "bootstrap", id] as const,
}

export function useWorkspaces() {
  const workspaceService = useWorkspaceService()

  return useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: async () => {
      const workspaces = await workspaceService.list()

      // Cache to IndexedDB
      const now = Date.now()
      await db.workspaces.bulkPut(
        workspaces.map((w) => ({ ...w, _cachedAt: now })),
      )

      return workspaces
    },
    // Try to use cached data while fetching fresh
    placeholderData: () => {
      // Sync read from IndexedDB for immediate display
      return undefined // Will be populated by initialData if available
    },
  })
}

export function useWorkspace(workspaceId: string) {
  const workspaceService = useWorkspaceService()

  return useQuery({
    queryKey: workspaceKeys.detail(workspaceId),
    queryFn: async () => {
      const workspace = await workspaceService.get(workspaceId)

      // Cache to IndexedDB
      await db.workspaces.put({ ...workspace, _cachedAt: Date.now() })

      return workspace
    },
    enabled: !!workspaceId,
  })
}

export function useWorkspaceBootstrap(workspaceId: string) {
  const workspaceService = useWorkspaceService()

  return useQuery({
    queryKey: workspaceKeys.bootstrap(workspaceId),
    queryFn: async () => {
      const bootstrap = await workspaceService.bootstrap(workspaceId)
      const now = Date.now()

      // Cache all data to IndexedDB
      await Promise.all([
        db.workspaces.put({ ...bootstrap.workspace, _cachedAt: now }),
        db.workspaceMembers.bulkPut(
          bootstrap.members.map((m) => ({
            id: `${m.workspaceId}:${m.userId}`,
            ...m,
            _cachedAt: now,
          })),
        ),
        db.streams.bulkPut(
          bootstrap.streams.map((s) => ({
            ...s,
            // Merge membership data if available
            pinned: bootstrap.streamMemberships.find((sm) => sm.streamId === s.id)?.pinned,
            muted: bootstrap.streamMemberships.find((sm) => sm.streamId === s.id)?.muted,
            lastReadEventId: bootstrap.streamMemberships.find((sm) => sm.streamId === s.id)
              ?.lastReadEventId,
            _cachedAt: now,
          })),
        ),
      ])

      return bootstrap
    },
    enabled: !!workspaceId,
  })
}

export function useCreateWorkspace() {
  const workspaceService = useWorkspaceService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { name: string; slug: string }) => workspaceService.create(data),
    onSuccess: (newWorkspace) => {
      // Update cache
      queryClient.setQueryData<Workspace[]>(workspaceKeys.list(), (old) =>
        old ? [...old, newWorkspace] : [newWorkspace],
      )

      // Cache to IndexedDB
      db.workspaces.put({ ...newWorkspace, _cachedAt: Date.now() })
    },
  })
}
