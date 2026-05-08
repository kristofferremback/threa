import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { Section } from "@/components/layout/section"
import { backofficeKeys, listWorkspaceMembers, type WorkspaceDetail, type WorkspaceMember } from "@/api/backoffice"
import { ApiError } from "@/api/client"
import { cn } from "@/lib/utils"
import { formatDateTime } from "@/lib/format"

function formatRelativeTimestamp(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const seconds = Math.floor((Date.now() - then) / 1000)
  if (seconds < 60) return "just now"
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    return `${m}m ago`
  }
  if (seconds < 86_400) {
    const h = Math.floor(seconds / 3600)
    return `${h}h ago`
  }
  const d = Math.floor(seconds / 86_400)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" })
}

function memberDisplayName(m: WorkspaceMember): string | null {
  const parts = [m.firstName, m.lastName].filter((x): x is string => !!x && x.length > 0)
  if (parts.length > 0) return parts.join(" ")
  return null
}

export function WorkspaceDetailMembersPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: id ? backofficeKeys.workspaceMembers(id) : ["backoffice", "workspaces", "missing", "members"],
    queryFn: () => {
      if (!id) throw new Error("Missing workspace id")
      return listWorkspaceMembers(id)
    },
    enabled: !!id,
  })

  // Cache-only observer (the layout owns the actual fetch). We read the
  // workspace to differentiate "not linked to WorkOS" from "linked but empty"
  // in the empty state, since both currently come back as `members: []`.
  const workspaceQ = useQuery({
    queryKey: id ? backofficeKeys.workspace(id) : ["backoffice", "workspaces", "missing"],
    queryFn: () => (id ? (queryClient.getQueryData<WorkspaceDetail>(backofficeKeys.workspace(id)) ?? null) : null),
    enabled: !!id,
    staleTime: Infinity,
  })

  const notLinked = workspaceQ.data ? workspaceQ.data.workosOrganizationId === null : false

  return (
    <Section
      label="Members"
      description="Mirror of WorkOS organization memberships. Updates within ~5s of changes in the WorkOS dashboard."
    >
      <MembersBody loading={query.isLoading} error={query.error} members={query.data} notLinked={notLinked} />
    </Section>
  )
}

function MembersBody({
  loading,
  error,
  members,
  notLinked,
}: {
  loading: boolean
  error: unknown
  members: WorkspaceMember[] | undefined
  notLinked: boolean
}) {
  if (loading) {
    return <div className="border-y px-1 py-10 text-center text-sm text-muted-foreground">Loading members…</div>
  }

  if (error) {
    const notFound = ApiError.isApiError(error) && error.status === 404
    return (
      <div className="border-y px-1 py-10 text-center text-sm text-muted-foreground">
        {notFound ? "That workspace doesn't exist." : "Couldn't load members."}
      </div>
    )
  }

  if (!members || members.length === 0) {
    return (
      <div className="border-y px-1 py-10 text-center text-sm text-muted-foreground">
        {notLinked
          ? "Workspace isn't linked to a WorkOS organization — no mirror data to show."
          : "No members yet — backfill may still be running."}
      </div>
    )
  }

  return (
    <ul className="divide-y border-y">
      {members.map((m) => (
        <MemberRow key={`${m.workosUserId}`} member={m} />
      ))}
    </ul>
  )
}

function MemberRow({ member }: { member: WorkspaceMember }) {
  const name = memberDisplayName(member)
  const fallback = member.email ?? member.workosUserId
  return (
    <li className="flex items-center justify-between gap-4 py-4 pl-1 pr-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm font-medium text-foreground">{name ?? fallback}</span>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {name && member.email ? <span className="truncate">{member.email}</span> : null}
          {member.roleSlugs.length > 0 ? (
            <>
              {name && member.email ? <span className="text-muted-foreground/50">·</span> : null}
              <RoleChips roles={member.roleSlugs} />
            </>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <StatusBadge status={member.status} />
        <span
          className="hidden text-xs tabular-nums text-muted-foreground sm:inline"
          title={formatDateTime(member.lastEventAt)}
        >
          {formatRelativeTimestamp(member.lastEventAt)}
        </span>
      </div>
    </li>
  )
}

function RoleChips({ roles }: { roles: string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {roles.map((role) => (
        <span
          key={role}
          className="inline-flex items-center rounded-full border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          {role}
        </span>
      ))}
    </span>
  )
}

const STATUS_VARIANTS: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
}
const STATUS_VARIANT_DEFAULT = "bg-muted text-muted-foreground"

function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_VARIANTS[status] ?? STATUS_VARIANT_DEFAULT
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        variant
      )}
    >
      {status}
    </span>
  )
}
