import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { invitationsApi } from "@/api/invitations"
import { workspaceKeys } from "@/hooks/use-workspaces"
import { InviteDialog } from "./invite-dialog"
import { WorkspaceCreationInviteDialog } from "./workspace-creation-invite-dialog"
import type { WorkspaceMember, WorkspaceInvitation } from "@threa/types"

interface MembersTabProps {
  workspaceId: string
}

export function MembersTab({ workspaceId }: MembersTabProps) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [workspaceCreationInviteOpen, setWorkspaceCreationInviteOpen] = useState(false)
  const queryClient = useQueryClient()

  const bootstrapData = queryClient.getQueryData<{
    members: WorkspaceMember[]
    invitations?: WorkspaceInvitation[]
  }>(workspaceKeys.bootstrap(workspaceId))

  const members = bootstrapData?.members ?? []

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
        <h3 className="text-sm font-medium">Members ({members.length})</h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setWorkspaceCreationInviteOpen(true)}>
            Invite Workspace Creator
          </Button>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            Invite
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {members.map((member) => (
          <div key={member.id} className="flex items-center justify-between rounded-md border px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{member.name || member.slug}</span>
              <span className="text-xs text-muted-foreground">@{member.slug}</span>
            </div>
            <Badge variant={member.role === "owner" ? "default" : "secondary"}>{member.role}</Badge>
          </div>
        ))}
      </div>

      {pendingInvitations.length > 0 && (
        <>
          <h3 className="text-sm font-medium">Pending Invitations ({pendingInvitations.length})</h3>
          <div className="space-y-2">
            {pendingInvitations.map((invitation) => (
              <div key={invitation.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{invitation.email}</span>
                  <Badge variant="outline">{invitation.role}</Badge>
                  <span className="text-xs text-muted-foreground">
                    Expires {new Date(invitation.expiresAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex gap-1">
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
      <WorkspaceCreationInviteDialog
        workspaceId={workspaceId}
        open={workspaceCreationInviteOpen}
        onOpenChange={setWorkspaceCreationInviteOpen}
      />
    </div>
  )
}
