import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { invitationsApi } from "@/api/invitations"
import { workspacesApi } from "@/api/workspaces"
import { workspaceKeys } from "@/hooks/use-workspaces"
import { useFormattedDate } from "@/hooks"
import { InviteDialog } from "./invite-dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { WorkspaceBootstrap } from "@threa/types"

interface UsersTabProps {
  workspaceId: string
}

export function UsersTab({ workspaceId }: UsersTabProps) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const queryClient = useQueryClient()
  const { formatDate } = useFormattedDate()

  const { data: bootstrapData } = useQuery({
    queryKey: workspaceKeys.bootstrap(workspaceId),
    queryFn: () => queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId)) ?? null,
    enabled: false,
    staleTime: Infinity,
  })

  const users = bootstrapData?.users ?? []
  const canManageRoles = bootstrapData?.viewerPermissions?.includes("members:write") ?? false

  const rolesQuery = useQuery({
    queryKey: ["workspace-roles", workspaceId],
    queryFn: () => workspacesApi.listRoles(workspaceId),
    enabled: canManageRoles,
  })

  const invitationsQuery = useQuery({
    queryKey: ["invitations", workspaceId],
    queryFn: () => invitationsApi.list(workspaceId),
    enabled: canManageRoles,
  })

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) => invitationsApi.revoke(workspaceId, invitationId),
    onSuccess: () => invitationsQuery.refetch(),
  })

  const resendMutation = useMutation({
    mutationFn: (invitationId: string) => invitationsApi.resend(workspaceId, invitationId),
    onSuccess: () => invitationsQuery.refetch(),
  })

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, roleSlug }: { userId: string; roleSlug: string }) =>
      workspacesApi.updateUserRole(workspaceId, userId, { roleSlug }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.bootstrap(workspaceId) })
    },
  })

  const pendingInvitations = (invitationsQuery.data ?? []).filter((i) => i.status === "pending")

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Users ({users.length})</h3>
        <Button size="sm" onClick={() => setInviteOpen(true)} disabled={!canManageRoles}>
          Invite
        </Button>
      </div>

      <div className="space-y-2">
        {users.map((user) => (
          <div key={user.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2 min-w-0">
              <span className="text-sm font-medium truncate">{user.name || user.slug}</span>
              <span className="text-xs text-muted-foreground truncate">@{user.slug}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {user.isOwner && <Badge variant="default">Owner</Badge>}
              {canManageRoles && user.canEditRole !== false && (rolesQuery.data?.length ?? 0) > 0 ? (
                <Select
                  value={user.assignedRole?.slug ?? ""}
                  onValueChange={(roleSlug) => updateRoleMutation.mutate({ userId: user.id, roleSlug })}
                  disabled={updateRoleMutation.isPending}
                >
                  <SelectTrigger className="h-8 min-w-36">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {rolesQuery.data?.map((role) => (
                      <SelectItem key={role.slug} value={role.slug}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="secondary" className="shrink-0">
                  {user.assignedRole?.name ?? user.role}
                </Badge>
              )}
              {user.canEditRole === false && (user.assignedRoles?.length ?? 0) > 1 && (
                <Badge variant="outline">Multiple roles</Badge>
              )}
            </div>
          </div>
        ))}
      </div>

      {pendingInvitations.length > 0 && (
        <>
          <h3 className="text-sm font-medium">Pending Invitations ({pendingInvitations.length})</h3>
          <div className="space-y-2">
            {pendingInvitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2 min-w-0">
                  <span className="text-sm truncate">{invitation.email}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{invitation.assignedRole?.name ?? invitation.roleSlug}</Badge>
                    <span className="text-xs text-muted-foreground">
                      Expires {formatDate(new Date(invitation.expiresAt))}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => resendMutation.mutate(invitation.id)}
                    disabled={resendMutation.isPending}
                  >
                    Resend
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revokeMutation.mutate(invitation.id)}
                    disabled={revokeMutation.isPending}
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <InviteDialog
        workspaceId={workspaceId}
        roles={rolesQuery.data ?? []}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onSuccess={() => invitationsQuery.refetch()}
      />
    </div>
  )
}
