import { useQuery } from "@tanstack/react-query"
import { PageHeader } from "@/components/layout/page-header"
import { useUser } from "@/auth"
import {
  backofficeKeys,
  listWorkspaceOwnerInvitations,
  listWorkspaces,
  type WorkspaceOwnerInvitation,
} from "@/api/backoffice"

function countByState(
  invitations: WorkspaceOwnerInvitation[] | undefined,
  state: WorkspaceOwnerInvitation["state"]
): number {
  return invitations?.filter((i) => i.state === state).length ?? 0
}

export function WelcomePage() {
  const user = useUser()
  const displayName = user?.name || user?.email

  const workspacesQ = useQuery({
    queryKey: backofficeKeys.workspaces,
    queryFn: listWorkspaces,
  })
  const invitesQ = useQuery({
    queryKey: backofficeKeys.invitations,
    queryFn: listWorkspaceOwnerInvitations,
  })

  const workspaceCount = workspacesQ.isLoading ? null : (workspacesQ.data?.length ?? 0)
  const pendingCount = invitesQ.isLoading ? null : countByState(invitesQ.data, "pending")
  const acceptedCount = invitesQ.isLoading ? null : countByState(invitesQ.data, "accepted")

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
      <PageHeader
        title={<>Welcome{displayName ? `, ${displayName}` : ""}.</>}
        description="The Threa backoffice is the home of everything that isn't bound to a single workspace. Sections are added as platform tools come online."
      />

      {/* Bordered band of numbers — one rule top and bottom, no boxes. */}
      <div className="grid grid-cols-1 divide-y border-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat label="Workspaces" value={workspaceCount} />
        <Stat label="Pending invites" value={pendingCount} />
        <Stat label="Accepted invites" value={acceptedCount} />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col gap-1 px-1 py-5 sm:px-6">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold tabular-nums text-foreground">
        {value == null ? <span className="text-muted-foreground">—</span> : value}
      </span>
    </div>
  )
}
