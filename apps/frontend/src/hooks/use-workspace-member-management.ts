import { useMutation } from "@tanstack/react-query"
import type { WorkspaceRoleSlug } from "@threa/types"
import { workspaceMembersApi } from "@/api/workspace-members"
import { db } from "@/db"

// Server is the source of truth; the regional event poller reconciles Dexie
// within a few seconds, so optimistic writes only need to survive that
// window.
export function useChangeWorkspaceMemberRole(workspaceId: string) {
  return useMutation({
    mutationFn: async (params: { userId: string; roleSlug: WorkspaceRoleSlug }) => {
      await workspaceMembersApi.changeRole(workspaceId, params.userId, params.roleSlug)
      return params
    },
    onMutate: async ({ userId, roleSlug }) => {
      const current = await db.workspaceUsers.get(userId)
      if (!current || current.role === roleSlug) {
        return { previousRole: current?.role ?? null }
      }
      await db.workspaceUsers.put({ ...current, role: roleSlug, _cachedAt: Date.now() })
      return { previousRole: current.role }
    },
    onError: async (_err, { userId }, context) => {
      if (!context?.previousRole) return
      const current = await db.workspaceUsers.get(userId)
      if (current) {
        void db.workspaceUsers.put({ ...current, role: context.previousRole, _cachedAt: Date.now() })
      }
    },
  })
}

export function useRemoveWorkspaceMember(workspaceId: string) {
  return useMutation({
    mutationFn: async (params: { userId: string }) => {
      await workspaceMembersApi.remove(workspaceId, params.userId)
      return params
    },
    onMutate: async ({ userId }) => {
      const snapshot = await db.workspaceUsers.get(userId)
      if (snapshot) {
        await db.workspaceUsers.delete(userId)
      }
      return { snapshot }
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) {
        void db.workspaceUsers.put(context.snapshot)
      }
    },
  })
}
