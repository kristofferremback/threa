import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  ResponsiveAlertDialog,
  ResponsiveAlertDialogAction,
  ResponsiveAlertDialogCancel,
  ResponsiveAlertDialogContent,
  ResponsiveAlertDialogDescription,
  ResponsiveAlertDialogFooter,
  ResponsiveAlertDialogHeader,
  ResponsiveAlertDialogTitle,
} from "@/components/ui/responsive-alert-dialog"
import { PageHeader } from "@/components/layout/page-header"
import { Section } from "@/components/layout/section"
import { ApiError } from "@/api/client"
import {
  backofficeKeys,
  createWorkspaceOwnerInvitation,
  listWorkspaceOwnerInvitations,
  resendWorkspaceOwnerInvitation,
  revokeWorkspaceOwnerInvitation,
  type WorkspaceOwnerInvitation,
} from "@/api/backoffice"

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function stateBadgeVariant(
  state: WorkspaceOwnerInvitation["state"]
): "default" | "secondary" | "destructive" | "outline" {
  if (state === "pending") return "default"
  if (state === "accepted") return "secondary"
  if (state === "revoked") return "destructive"
  return "outline"
}

function timestampLabel(invitation: WorkspaceOwnerInvitation): string {
  if (invitation.state === "accepted" && invitation.acceptedAt) {
    return `Accepted ${formatDateTime(invitation.acceptedAt)}`
  }
  if (invitation.state === "revoked" && invitation.revokedAt) {
    return `Revoked ${formatDateTime(invitation.revokedAt)}`
  }
  if (invitation.state === "pending") {
    return `Expires ${formatDateTime(invitation.expiresAt)}`
  }
  return `Expired ${formatDateTime(invitation.expiresAt)}`
}

function readApiError(error: unknown): string | null {
  if (!error) return null
  if (ApiError.isApiError(error)) return error.message
  return "Something went wrong"
}

export function InviteWorkspaceOwnerPage() {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState("")
  // Controlled-by-target pattern: opening the dialog = setting a target.
  // Closing it (cancel, overlay click, confirm) = clearing the target.
  const [revokeTarget, setRevokeTarget] = useState<WorkspaceOwnerInvitation | null>(null)

  const invitationsQ = useQuery({
    queryKey: backofficeKeys.invitations,
    queryFn: listWorkspaceOwnerInvitations,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: backofficeKeys.invitations })

  const createMutation = useMutation({
    mutationFn: (payload: string) => createWorkspaceOwnerInvitation(payload),
    onSuccess: () => {
      setEmail("")
      invalidate()
    },
  })

  const resendMutation = useMutation({
    mutationFn: (id: string) => resendWorkspaceOwnerInvitation(id),
    onSuccess: () => invalidate(),
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeWorkspaceOwnerInvitation(id),
    onSuccess: () => invalidate(),
  })

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!email) return
    createMutation.mutate(email)
  }

  const handleConfirmRevoke = () => {
    if (!revokeTarget) return
    revokeMutation.mutate(revokeTarget.id)
    setRevokeTarget(null)
  }

  const { pending, history } = useMemo(() => {
    const data = invitationsQ.data ?? []
    const sorted = [...data].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return {
      pending: sorted.filter((i) => i.state === "pending"),
      history: sorted.filter((i) => i.state !== "pending"),
    }
  }, [invitationsQ.data])

  const createError = readApiError(createMutation.error)
  const resendError = readApiError(resendMutation.error)
  const revokeError = readApiError(revokeMutation.error)

  // Track which invitation is currently being mutated so only its row shows a
  // disabled state (rather than disabling the whole list while one request is
  // in flight).
  let busyId: string | null = null
  if (resendMutation.isPending) busyId = resendMutation.variables ?? null
  else if (revokeMutation.isPending) busyId = revokeMutation.variables ?? null

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
      <PageHeader
        title="Workspace owner invitations"
        description="Send a Threa invitation via WorkOS. When the invitee accepts and signs in, they can create their own workspace."
      />

      <Section label="New invitation" description="Enter the email address of the person you want to invite.">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 border-t pt-5">
          <div className="flex flex-col gap-2 sm:max-w-md">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="owner@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={createMutation.isPending}
            />
          </div>

          {createMutation.isSuccess ? (
            <InlineBanner tone="success">
              Invitation sent to <span className="font-medium">{createMutation.data.email}</span>.
            </InlineBanner>
          ) : null}

          {createError ? <InlineBanner tone="error">{createError}</InlineBanner> : null}

          <div>
            <Button type="submit" disabled={createMutation.isPending || !email}>
              {createMutation.isPending ? "Sending…" : "Send invitation"}
            </Button>
          </div>
        </form>
      </Section>

      {/* Row-level error banners live here so they don't reflow the list. */}
      {resendError || revokeError ? (
        <div className="flex flex-col gap-2">
          {resendError ? <InlineBanner tone="error">Couldn't resend invitation: {resendError}</InlineBanner> : null}
          {revokeError ? <InlineBanner tone="error">Couldn't revoke invitation: {revokeError}</InlineBanner> : null}
        </div>
      ) : null}

      <Section label={`Pending · ${pending.length}`}>
        <InvitationList
          loading={invitationsQ.isLoading}
          invitations={pending}
          emptyCopy="No pending invitations."
          renderRow={(inv) => (
            <InvitationRow
              key={inv.id}
              invitation={inv}
              busy={busyId === inv.id}
              onResend={() => resendMutation.mutate(inv.id)}
              onRevoke={() => setRevokeTarget(inv)}
            />
          )}
        />
      </Section>

      <Section label={`History · ${history.length}`}>
        <InvitationList
          loading={invitationsQ.isLoading}
          invitations={history}
          emptyCopy="No accepted, revoked, or expired invitations yet."
          renderRow={(inv) => <InvitationRow key={inv.id} invitation={inv} />}
        />
      </Section>

      <ResponsiveAlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
      >
        <ResponsiveAlertDialogContent>
          <ResponsiveAlertDialogHeader>
            <ResponsiveAlertDialogTitle>Revoke this invitation?</ResponsiveAlertDialogTitle>
            <ResponsiveAlertDialogDescription>
              {revokeTarget ? (
                <>
                  The invitation for <span className="font-medium text-foreground">{revokeTarget.email}</span> will be
                  revoked immediately. They won't be able to accept it after this.
                </>
              ) : null}
            </ResponsiveAlertDialogDescription>
          </ResponsiveAlertDialogHeader>
          <ResponsiveAlertDialogFooter>
            <ResponsiveAlertDialogCancel>Keep invitation</ResponsiveAlertDialogCancel>
            <ResponsiveAlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={handleConfirmRevoke}
            >
              Revoke
            </ResponsiveAlertDialogAction>
          </ResponsiveAlertDialogFooter>
        </ResponsiveAlertDialogContent>
      </ResponsiveAlertDialog>
    </div>
  )
}

function InlineBanner({ tone, children }: { tone: "success" | "error"; children: React.ReactNode }) {
  const Icon = tone === "success" ? CheckCircle2 : AlertTriangle
  const toneClasses =
    tone === "success"
      ? "border-primary/30 bg-accent/40 text-accent-foreground"
      : "border-destructive/40 bg-destructive/5 text-destructive"
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${toneClasses}`}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

function InvitationList({
  loading,
  invitations,
  emptyCopy,
  renderRow,
}: {
  loading: boolean
  invitations: WorkspaceOwnerInvitation[]
  emptyCopy: string
  renderRow: (invitation: WorkspaceOwnerInvitation) => React.ReactNode
}) {
  if (loading) {
    return <div className="border-y px-1 py-6 text-center text-xs text-muted-foreground">Loading…</div>
  }
  if (invitations.length === 0) {
    return <div className="border-y px-1 py-6 text-center text-xs text-muted-foreground">{emptyCopy}</div>
  }
  return <ul className="divide-y border-y">{invitations.map(renderRow)}</ul>
}

function InvitationRow({
  invitation,
  busy,
  onResend,
  onRevoke,
}: {
  invitation: WorkspaceOwnerInvitation
  busy?: boolean
  onResend?: () => void
  onRevoke?: () => void
}) {
  const hasActions = onResend && onRevoke
  return (
    <li
      className={
        hasActions
          ? "flex flex-col gap-3 border-l-[3px] border-l-transparent py-4 pl-4 pr-3 transition-colors hover:border-l-primary hover:bg-accent/30 sm:flex-row sm:items-center sm:justify-between"
          : "flex flex-col gap-3 py-4 pl-4 pr-3 sm:flex-row sm:items-center sm:justify-between"
      }
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{invitation.email}</span>
          <Badge variant={stateBadgeVariant(invitation.state)} className="capitalize">
            {invitation.state}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{timestampLabel(invitation)}</span>
          {invitation.workspaces.length > 0 ? (
            <span className="flex items-center gap-1">
              <span className="text-muted-foreground/70">·</span>
              <WorkspaceLinks workspaces={invitation.workspaces} />
            </span>
          ) : null}
        </div>
      </div>
      {hasActions ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onResend} disabled={busy}>
            Resend
          </Button>
          <Button size="sm" variant="ghost" onClick={onRevoke} disabled={busy}>
            Revoke
          </Button>
        </div>
      ) : null}
    </li>
  )
}

function WorkspaceLinks({ workspaces }: { workspaces: WorkspaceOwnerInvitation["workspaces"] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      Joined
      {workspaces.map((ws, i) => (
        <span key={ws.id} className="inline-flex items-center gap-1">
          <Link to={`/workspaces/${ws.id}`} className="text-primary underline-offset-2 hover:underline">
            {ws.name}
          </Link>
          {i < workspaces.length - 1 ? <span>,</span> : null}
        </span>
      ))}
    </span>
  )
}
