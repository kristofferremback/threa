import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { invitationsApi } from "@/api/invitations"
import { workspaceKeys } from "@/hooks/use-workspaces"
import { useFormattedDate } from "@/hooks"
import { InviteDialog } from "./invite-dialog"
import type { User, WorkspaceInvitation } from "@threa/types"

interface UsersTabProps {
  workspaceId: string
}

export function UsersTab({ workspaceId }: UsersTabProps) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const queryClient = useQueryClient()
  const { formatDate } = useFormattedDate()

  const bootstrapData = queryClient.getQueryData<{
    users: User[]
    invitations?: WorkspaceInvitation[]
  }>(workspaceKeys.bootstrap(workspaceId))

  const users = bootstrapData?.users ?? []

  const invitationsQuery = useQuery({
    queryKey: ["invitations", workspaceId],
    queryFn: () => invitationsApi.list(workspaceId),
  })

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) => invitationsApi.revoke(workspaceId, invitationId),
    onSuccess: () => invitationsQuery.refetch(),
  })

  const resendMutation = useMutation({
    mutationFn: (invitationId: string) => invitationsApi.resend(workspaceId, invitationId),
    onSuccess: () => invitationsQuery.refetch(),
  })

  const pendingInvitations = (invitationsQuery.data ?? []).filter((i) => i.status === "pending")

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Users ({users.length})</h3>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
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
            <Badge variant={user.role === "owner" ? "default" : "secondary"} className="shrink-0">
              {user.role}
            </Badge>
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
                    <Badge variant="outline">{invitation.role}</Badge>
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
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onSuccess={() => invitationsQuery.refetch()}
      />
    </div>
  )
}
