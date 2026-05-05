import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Mail, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ThreaLogo } from "@/components/threa-logo"
import { ApiError } from "@/api/client"
import { invitationsApi } from "@/api/invitations"
import { formatDisplayDate } from "@/lib/dates"

type LookupErrorCode =
  | "INVITATION_NOT_FOUND"
  | "INVITATION_REVOKED"
  | "INVITATION_EXPIRED"
  | "INVITATION_ALREADY_CLAIMED"

interface LookupErrorCopy {
  title: string
  body: string
}

const LOOKUP_ERROR_COPY: Record<LookupErrorCode, LookupErrorCopy> = {
  INVITATION_NOT_FOUND: {
    title: "Invitation not found",
    body: "This link is invalid or no longer exists. Ask the workspace admin for a fresh one.",
  },
  INVITATION_REVOKED: {
    title: "Invitation revoked",
    body: "This invitation has been revoked. Ask the workspace admin for a new link.",
  },
  INVITATION_EXPIRED: {
    title: "Invitation expired",
    body: "This invite link has expired. Ask the workspace admin for a fresh one.",
  },
  INVITATION_ALREADY_CLAIMED: {
    title: "Link already used",
    body: "This invitation link has already been claimed. Ask for a fresh one if you still need access.",
  },
}

function getErrorCode(err: unknown): LookupErrorCode | null {
  if (ApiError.isApiError(err) && err.code in LOOKUP_ERROR_COPY) {
    return err.code as LookupErrorCode
  }
  return null
}

function resolveClaimErrorMessage(code: LookupErrorCode | null, err: unknown): string | null {
  if (code) return LOOKUP_ERROR_COPY[code].body
  if (err instanceof Error) return err.message
  return null
}

/**
 * Centred shell shared by every state on the join page. Mirrors the
 * `LoginPage` / `WorkspaceSelectPage` layout: full-height, `bg-background`,
 * a vertical column with `ThreaLogo` at the top and content below.
 */
function JoinShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex w-full max-w-md flex-col items-center gap-8 p-6">
        <ThreaLogo size="lg" />
        {children}
      </div>
    </div>
  )
}

export function JoinPage() {
  const { token } = useParams<{ token: string }>()
  const [email, setEmail] = useState("")
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)
  const [alreadyMemberWorkspaceId, setAlreadyMemberWorkspaceId] = useState<string | null>(null)

  const lookupQuery = useQuery({
    queryKey: ["invitation-lookup", token],
    queryFn: () => invitationsApi.lookupLink(token!),
    enabled: !!token,
    retry: false,
  })

  const claimMutation = useMutation({
    mutationFn: (claimEmail: string) => invitationsApi.claimLink({ token: token!, email: claimEmail }),
    onSuccess: (data) => {
      setSubmittedEmail(email.trim())
      if (data.alreadyMember) {
        setAlreadyMemberWorkspaceId(data.alreadyMember.workspaceId)
      }
    },
  })

  // Reset claim state if token changes (shouldn't happen, but defensive)
  useEffect(() => {
    setSubmittedEmail(null)
    setAlreadyMemberWorkspaceId(null)
  }, [token])

  if (!token) {
    return (
      <JoinShell>
        <ErrorState code="INVITATION_NOT_FOUND" />
      </JoinShell>
    )
  }

  if (lookupQuery.isLoading) {
    return (
      <JoinShell>
        <div className="text-center">
          <h1 className="text-xl font-medium">Loading invitation</h1>
          <p className="mt-1 text-sm text-muted-foreground">Just a moment…</p>
        </div>
      </JoinShell>
    )
  }

  if (lookupQuery.isError) {
    const code = getErrorCode(lookupQuery.error) ?? "INVITATION_NOT_FOUND"
    return (
      <JoinShell>
        <ErrorState code={code} />
      </JoinShell>
    )
  }

  const data = lookupQuery.data!

  if (submittedEmail) {
    return (
      <JoinShell>
        <SubmittedState
          email={submittedEmail}
          workspaceName={data.workspaceName}
          alreadyMember={!!alreadyMemberWorkspaceId}
        />
      </JoinShell>
    )
  }

  const claimError = claimMutation.error
  const claimErrorCode = getErrorCode(claimError)
  const claimErrorMessage = resolveClaimErrorMessage(claimErrorCode, claimError)

  const trimmedEmail = email.trim()
  const canSubmit = !!trimmedEmail && !claimMutation.isPending

  return (
    <JoinShell>
      <div className="w-full space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-medium">
            You've been invited to <span className="text-primary">{data.workspaceName}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your email and we'll send a sign-in link. Expires {formatDisplayDate(new Date(data.expiresAt))}.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) claimMutation.mutate(trimmedEmail)
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="join-email">Email</Label>
            <Input
              id="join-email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={claimMutation.isPending}
            />
          </div>

          {claimErrorMessage && <p className="text-sm text-destructive">{claimErrorMessage}</p>}

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {claimMutation.isPending ? "Sending..." : "Continue"}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Single-use link. Already have an account?{" "}
          <Link to="/login" className="underline underline-offset-4 hover:text-foreground">
            Sign in
          </Link>
        </p>
      </div>
    </JoinShell>
  )
}

function ErrorState({ code }: { code: LookupErrorCode }) {
  const copy = LOOKUP_ERROR_COPY[code]
  return (
    <div className="text-center space-y-4">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border bg-muted/50">
        <ShieldAlert className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <h1 className="text-xl font-medium">{copy.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{copy.body}</p>
      </div>
      <Button asChild variant="outline">
        <Link to="/login">Sign in instead</Link>
      </Button>
    </div>
  )
}

function SubmittedState({
  email,
  workspaceName,
  alreadyMember,
}: {
  email: string
  workspaceName: string
  alreadyMember: boolean
}) {
  if (alreadyMember) {
    return (
      <div className="w-full space-y-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border bg-muted/50">
          <Mail className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-medium">You're already a member</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="text-foreground">{email}</span> already belongs to{" "}
            <span className="text-foreground">{workspaceName}</span>. Sign in to continue.
          </p>
        </div>
        <Button asChild className="w-full">
          <Link to="/login">Sign in</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="w-full space-y-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border bg-muted/50">
        <Mail className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <h1 className="text-xl font-medium">Check your inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a sign-in link to <span className="text-foreground">{email}</span>. Click it to join{" "}
          <span className="text-foreground">{workspaceName}</span>.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Didn't get it? Check your spam folder, or{" "}
        <Link to="/login" className="underline underline-offset-4 hover:text-foreground">
          sign in
        </Link>{" "}
        if you already have an account.
      </p>
    </div>
  )
}
