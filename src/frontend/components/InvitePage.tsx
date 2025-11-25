import { useState, useEffect } from "react"
import { UserPlus, Check, X, AlertCircle, Clock, LogIn } from "lucide-react"
import { useAuth } from "../auth"
import { Button, Spinner } from "./ui"

interface InvitePageProps {
  token: string
}

interface InvitationDetails {
  id: string
  workspaceId: string
  workspaceName: string
  email: string
  role: string
  status: string
  expiresAt: string
  invitedByEmail: string
}

export function InvitePage({ token }: InvitePageProps) {
  const { isAuthenticated, user, state } = useAuth()
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAccepting, setIsAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    const fetchInvitation = async () => {
      try {
        const res = await fetch(`/api/invite/${token}`)
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || "Failed to load invitation")
        }

        setInvitation(data)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setIsLoading(false)
      }
    }

    fetchInvitation()
  }, [token])

  const handleAccept = async () => {
    setIsAccepting(true)
    setError(null)

    try {
      const res = await fetch(`/api/invite/${token}/accept`, {
        method: "POST",
        credentials: "include",
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to accept invitation")
      }

      setAccepted(true)

      // Redirect to workspace after a short delay
      setTimeout(() => {
        window.location.href = "/"
      }, 2000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsAccepting(false)
    }
  }

  const handleLogin = () => {
    // Pass the invite URL as a redirect parameter
    const redirectUrl = encodeURIComponent(window.location.pathname)
    window.location.href = `/api/auth/login?redirect=${redirectUrl}`
  }

  // Loading state
  if (isLoading || state === "loading" || state === "new") {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--bg-primary)" }}
      >
        <Spinner size="lg" />
      </div>
    )
  }

  // Error state
  if (error && !invitation) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: "var(--bg-primary)" }}
      >
        <div
          className="max-w-md w-full p-8 rounded-2xl text-center"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: "var(--error-bg)" }}
          >
            <X className="h-8 w-8" style={{ color: "var(--error)" }} />
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
            Invalid Invitation
          </h1>
          <p className="mb-6" style={{ color: "var(--text-secondary)" }}>
            {error}
          </p>
          <Button onClick={() => (window.location.href = "/")} variant="secondary">
            Go to Home
          </Button>
        </div>
      </div>
    )
  }

  // Expired invitation
  if (invitation?.status === "expired") {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: "var(--bg-primary)" }}
      >
        <div
          className="max-w-md w-full p-8 rounded-2xl text-center"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: "var(--warning-bg)" }}
          >
            <Clock className="h-8 w-8" style={{ color: "var(--warning)" }} />
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
            Invitation Expired
          </h1>
          <p className="mb-6" style={{ color: "var(--text-secondary)" }}>
            This invitation to <strong>{invitation.workspaceName}</strong> has expired.
            Please ask the workspace admin for a new invitation.
          </p>
          <Button onClick={() => (window.location.href = "/")} variant="secondary">
            Go to Home
          </Button>
        </div>
      </div>
    )
  }

  // Already accepted
  if (invitation?.status === "accepted") {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: "var(--bg-primary)" }}
      >
        <div
          className="max-w-md w-full p-8 rounded-2xl text-center"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: "var(--success-bg)" }}
          >
            <Check className="h-8 w-8" style={{ color: "var(--success)" }} />
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
            Already Accepted
          </h1>
          <p className="mb-6" style={{ color: "var(--text-secondary)" }}>
            This invitation has already been accepted.
          </p>
          <Button onClick={() => (window.location.href = "/")} variant="primary">
            Go to Workspace
          </Button>
        </div>
      </div>
    )
  }

  // Success state
  if (accepted) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: "var(--bg-primary)" }}
      >
        <div
          className="max-w-md w-full p-8 rounded-2xl text-center"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: "var(--success-bg)" }}
          >
            <Check className="h-8 w-8" style={{ color: "var(--success)" }} />
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
            Welcome to {invitation?.workspaceName}!
          </h1>
          <p className="mb-4" style={{ color: "var(--text-secondary)" }}>
            You're now a member. Redirecting you to the workspace...
          </p>
          <Spinner size="sm" />
        </div>
      </div>
    )
  }

  // Not authenticated - show login prompt
  if (!isAuthenticated) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: "var(--bg-primary)" }}
      >
        <div
          className="max-w-md w-full p-8 rounded-2xl"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}
        >
          <div className="text-center mb-6">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: "var(--accent-glow)" }}
            >
              <UserPlus className="h-8 w-8" style={{ color: "var(--accent-primary)" }} />
            </div>
            <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
              You're Invited!
            </h1>
            <p style={{ color: "var(--text-secondary)" }}>
              <strong>{invitation?.invitedByEmail}</strong> has invited you to join
            </p>
            <p className="text-xl font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
              {invitation?.workspaceName}
            </p>
          </div>

          <div
            className="p-4 rounded-lg mb-6"
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)" }}
          >
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: "var(--text-muted)" }}>Invited as</span>
              <span
                className="px-2 py-1 rounded font-medium"
                style={{ background: "var(--accent-glow)", color: "var(--accent-primary)" }}
              >
                {invitation?.role}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm mt-2">
              <span style={{ color: "var(--text-muted)" }}>Email</span>
              <span style={{ color: "var(--text-primary)" }}>{invitation?.email}</span>
            </div>
          </div>

          <Button onClick={handleLogin} variant="primary" className="w-full">
            <LogIn className="h-4 w-4" />
            Sign in to Accept
          </Button>

          <p className="text-xs text-center mt-4" style={{ color: "var(--text-muted)" }}>
            You'll need to sign in with <strong>{invitation?.email}</strong> to accept this invitation.
          </p>
        </div>
      </div>
    )
  }

  // Email mismatch warning
  const emailMismatch = user?.email?.toLowerCase() !== invitation?.email.toLowerCase()

  // Authenticated - show accept button
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "var(--bg-primary)" }}
    >
      <div
        className="max-w-md w-full p-8 rounded-2xl"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}
      >
        <div className="text-center mb-6">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: "var(--accent-glow)" }}
          >
            <UserPlus className="h-8 w-8" style={{ color: "var(--accent-primary)" }} />
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
            Join {invitation?.workspaceName}
          </h1>
          <p style={{ color: "var(--text-secondary)" }}>
            <strong>{invitation?.invitedByEmail}</strong> has invited you to join this workspace.
          </p>
        </div>

        {emailMismatch && (
          <div
            className="p-4 rounded-lg mb-4 flex items-start gap-3"
            style={{ background: "var(--warning-bg)", border: "1px solid var(--warning)" }}
          >
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: "var(--warning)" }} />
            <div>
              <p className="font-medium text-sm" style={{ color: "var(--warning)" }}>
                Email Mismatch
              </p>
              <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
                This invitation was sent to <strong>{invitation?.email}</strong>, but you're signed in as{" "}
                <strong>{user?.email}</strong>. You may not be able to accept this invitation.
              </p>
            </div>
          </div>
        )}

        <div
          className="p-4 rounded-lg mb-6"
          style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center justify-between text-sm">
            <span style={{ color: "var(--text-muted)" }}>Your role</span>
            <span
              className="px-2 py-1 rounded font-medium"
              style={{ background: "var(--accent-glow)", color: "var(--accent-primary)" }}
            >
              {invitation?.role}
            </span>
          </div>
        </div>

        {error && (
          <div
            className="p-3 rounded-lg mb-4 text-sm"
            style={{ background: "var(--error-bg)", color: "var(--error)" }}
          >
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <Button onClick={() => (window.location.href = "/")} variant="secondary" className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleAccept} variant="primary" className="flex-1" disabled={isAccepting}>
            {isAccepting ? <Spinner size="sm" /> : <Check className="h-4 w-4" />}
            Accept Invitation
          </Button>
        </div>
      </div>
    </div>
  )
}

