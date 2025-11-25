import { useState } from "react"
import { X, Copy, Check, Mail, UserPlus } from "lucide-react"
import { Modal, Button, Input, Spinner } from "./ui"

interface InviteModalProps {
  isOpen: boolean
  onClose: () => void
  workspaceId: string
  workspaceName: string
}

interface Invitation {
  id: string
  token: string
  expiresAt: string
  inviteUrl: string
}

export function InviteModal({ isOpen, onClose, workspaceId, workspaceName }: InviteModalProps) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"member" | "admin">("member")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [copied, setCopied] = useState(false)

  const handleInvite = async () => {
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/workspace/${workspaceId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), role }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to create invitation")
      }

      setInvitation(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopyLink = async () => {
    if (!invitation) return

    const fullUrl = `${window.location.origin}/invite/${invitation.token}`
    await navigator.clipboard.writeText(fullUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = () => {
    setEmail("")
    setRole("member")
    setError(null)
    setInvitation(null)
    setCopied(false)
    onClose()
  }

  const handleSendAnother = () => {
    setEmail("")
    setInvitation(null)
    setError(null)
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="md">
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <UserPlus className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
            <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              Invite to {workspaceName}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {invitation ? (
          <div className="space-y-4">
            <div
              className="p-4 rounded-lg flex items-start gap-3"
              style={{ background: "var(--success-bg)", border: "1px solid var(--success)" }}
            >
              <Check className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: "var(--success)" }} />
              <div>
                <p className="font-medium" style={{ color: "var(--success)" }}>
                  Invitation created!
                </p>
                <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
                  Share the link below with <strong>{email}</strong>
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                Invitation Link
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}/invite/${invitation.token}`}
                  className="flex-1 px-3 py-2 text-sm rounded-lg"
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-primary)",
                  }}
                />
                <Button onClick={handleCopyLink} variant={copied ? "primary" : "secondary"}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                This link expires on {new Date(invitation.expiresAt).toLocaleDateString()}
              </p>
            </div>

            <div className="flex gap-3 pt-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <Button onClick={handleSendAnother} variant="secondary" className="flex-1">
                <Mail className="h-4 w-4" />
                Invite Another
              </Button>
              <Button onClick={handleClose} variant="primary" className="flex-1">
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                Email Address
              </label>
              <Input
                type="email"
                placeholder="colleague@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                Role
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setRole("member")}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    background: role === "member" ? "var(--accent-primary)" : "var(--bg-tertiary)",
                    color: role === "member" ? "white" : "var(--text-secondary)",
                    border: `1px solid ${role === "member" ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                  }}
                >
                  Member
                </button>
                <button
                  onClick={() => setRole("admin")}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    background: role === "admin" ? "var(--accent-primary)" : "var(--bg-tertiary)",
                    color: role === "admin" ? "white" : "var(--text-secondary)",
                    border: `1px solid ${role === "admin" ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                  }}
                >
                  Admin
                </button>
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {role === "admin"
                  ? "Admins can manage channels, invite members, and access settings."
                  : "Members can participate in channels and conversations."}
              </p>
            </div>

            {error && (
              <div
                className="p-3 rounded-lg text-sm"
                style={{ background: "var(--error-bg)", color: "var(--error)" }}
              >
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <Button onClick={handleClose} variant="secondary" className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleInvite} variant="primary" className="flex-1" disabled={isLoading}>
                {isLoading ? <Spinner size="sm" /> : <UserPlus className="h-4 w-4" />}
                Send Invitation
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

