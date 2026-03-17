import { useCallback, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useSocket, useWorkspaceService } from "@/contexts"
import { useUser } from "@/auth"
import { debugBootstrap } from "@/lib/bootstrap-debug"
import { getQueryLoadState, isTerminalBootstrapError } from "@/lib/query-load-state"
import { db } from "@/db"
import { joinRoomBestEffort } from "@/lib/socket-room"
import type { WorkspaceBootstrap, User } from "@threa/types"
import type { WorkspaceListResult } from "@/api/workspaces"

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

  const query = useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: async () => {
      const result = await workspaceService.list()

      // Cache to IndexedDB
      const now = Date.now()
      await db.workspaces.bulkPut(result.workspaces.map((w) => ({ ...w, _cachedAt: now })))

      return result
    },
    // Try to use cached data while fetching fresh
    placeholderData: () => {
      // Sync read from IndexedDB for immediate display
      return undefined // Will be populated by initialData if available
    },
  })

  return {
    ...query,
    workspaces: query.data?.workspaces,
    pendingInvitations: query.data?.pendingInvitations ?? [],
    isFetching: query.isFetching,
  }
}

export function useAcceptInvitation() {
  const workspaceService = useWorkspaceService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (invitationId: string) => workspaceService.acceptInvitation(invitationId),
    onSuccess: () => {
      // Fire-and-forget: don't await so per-call onSuccess (navigate) fires promptly
      // and races don't cause the workspace-select auto-redirect to win
      queryClient.invalidateQueries({ queryKey: workspaceKeys.list() })
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
  const socket = useSocket()
  const workspaceService = useWorkspaceService()
  const queryClient = useQueryClient()

  // Check if this query has already errored - don't re-enable if so
  // This prevents continuous refetching when the server is down
  const existingQueryState = queryClient.getQueryState(workspaceKeys.bootstrap(workspaceId))
  const hasTerminalError = existingQueryState?.status === "error" && isTerminalBootstrapError(existingQueryState.error)
  // Detect if we have seeded data from IndexedDB cache (set before socket connects).
  // Seeded data is marked as invalidated by cache-seed.ts, but with staleTime: Infinity
  // and refetchOnMount: false, the queryFn might not run. Force refetch on mount when
  // seeded so the queryFn executes (joining the socket room and fetching fresh data).
  const hasSeededData = existingQueryState?.status === "success" && existingQueryState.isInvalidated

  const query = useQuery({
    queryKey: workspaceKeys.bootstrap(workspaceId),
    queryFn: async () => {
      debugBootstrap("Workspace bootstrap queryFn start", { workspaceId, hasSocket: !!socket })
      if (!socket) {
        debugBootstrap("Workspace bootstrap missing socket", { workspaceId })
        throw new Error("Socket not available for workspace subscription")
      }
      await joinRoomBestEffort(socket, `ws:${workspaceId}`, "WorkspaceBootstrap")

      const bootstrap = await workspaceService.bootstrap(workspaceId)
      const users = bootstrap.users
      debugBootstrap("Workspace bootstrap fetch success", {
        workspaceId,
        streamCount: bootstrap.streams.length,
        userCount: users.length,
      })
      const now = Date.now()

      // Cache all data to IndexedDB
      await Promise.all([
        db.workspaces.put({ ...bootstrap.workspace, _cachedAt: now }),
        db.workspaceUsers.bulkPut(
          users.map((u) => ({
            ...u,
            _cachedAt: now,
          }))
        ),
        db.streams.bulkPut(
          bootstrap.streams.map((s) => ({
            ...s,
            // Merge membership data if available
            pinned: bootstrap.streamMemberships.find((sm) => sm.streamId === s.id)?.pinned,
            notificationLevel: bootstrap.streamMemberships.find((sm) => sm.streamId === s.id)?.notificationLevel,
            lastReadEventId: bootstrap.streamMemberships.find((sm) => sm.streamId === s.id)?.lastReadEventId,
            _cachedAt: now,
          }))
        ),
        db.personas.bulkPut(bootstrap.personas.map((p) => ({ ...p, _cachedAt: now }))),
      ])

      return bootstrap
    },
    // Keep terminal auth/not-found errors disabled to avoid loops.
    // Non-terminal errors can recover automatically on future attempts.
    enabled: !!workspaceId && !!socket && !hasTerminalError,
    // Prevent automatic refetching - socket events handle updates
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    // When seeded from IndexedDB cache, force refetch to join the socket room
    // and replace stale data. Otherwise skip mount refetch since socket events
    // keep the data up to date after the initial fetch.
    refetchOnMount: hasSeededData ? "always" : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const loadState = getQueryLoadState(query.status, query.fetchStatus)

  debugBootstrap("Workspace bootstrap observer state", {
    workspaceId,
    enabled: !!workspaceId && !!socket && !hasTerminalError,
    hasTerminalError,
    loadState,
    status: query.status,
    fetchStatus: query.fetchStatus,
    isPending: query.isPending,
    isLoading: query.isLoading,
    isError: query.isError,
  })

  // Manual retry that resets error state first
  const retryBootstrap = useCallback(() => {
    queryClient.resetQueries({ queryKey: workspaceKeys.bootstrap(workspaceId) })
  }, [queryClient, workspaceId])

  return { ...query, loadState, retryBootstrap }
}

export function useRegions() {
  const workspaceService = useWorkspaceService()

  return useQuery({
    queryKey: ["regions"] as const,
    queryFn: () => workspaceService.listRegions(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useCreateWorkspace() {
  const workspaceService = useWorkspaceService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { name: string; slug: string; region?: string }) => workspaceService.create(data),
    onSuccess: (newWorkspace) => {
      // Update cache with correct WorkspaceListResult shape
      queryClient.setQueryData<WorkspaceListResult>(workspaceKeys.list(), (old) => ({
        workspaces: old ? [...old.workspaces, newWorkspace] : [newWorkspace],
        pendingInvitations: old?.pendingInvitations ?? [],
      }))

      // Cache to IndexedDB
      db.workspaces.put({ ...newWorkspace, _cachedAt: Date.now() })
    },
  })
}

function updateUserInBootstrap(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string, updatedUser: User) {
  queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
    if (!old) return old
    const users = old.users
    return {
      ...old,
      users: users.map((u) => (u.id === updatedUser.id ? updatedUser : u)),
    }
  })

  db.workspaceUsers.put({ ...updatedUser, _cachedAt: Date.now() })
}

export function useUpdateProfile(workspaceId: string) {
  const workspaceService = useWorkspaceService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      name?: string
      description?: string | null
      pronouns?: string | null
      phone?: string | null
      githubUsername?: string | null
    }) => workspaceService.updateProfile(workspaceId, data),
    onSuccess: (user) => updateUserInBootstrap(queryClient, workspaceId, user),
  })
}

export function useUploadAvatar(workspaceId: string) {
  const workspaceService = useWorkspaceService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (file: File) => workspaceService.uploadAvatar(workspaceId, file),
    onSuccess: (user) => updateUserInBootstrap(queryClient, workspaceId, user),
  })
}

/** Returns the workspace-scoped user ID for the current WorkOS user, or null if not found. */
export function useWorkspaceUserId(workspaceId: string): string | null {
  const user = useUser()
  const { data: wsBootstrap } = useWorkspaceBootstrap(workspaceId)
  return useMemo(
    () => wsBootstrap?.users?.find((u) => u.workosUserId === user?.id)?.id ?? null,
    [wsBootstrap?.users, user?.id]
  )
}

export function useRemoveAvatar(workspaceId: string) {
  const workspaceService = useWorkspaceService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => workspaceService.removeAvatar(workspaceId),
    onSuccess: (user) => updateUserInBootstrap(queryClient, workspaceId, user),
  })
}
