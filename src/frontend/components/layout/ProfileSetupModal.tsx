import { useState, useRef, useEffect } from "react"
import { User, Briefcase } from "lucide-react"
import { Button, Spinner, Avatar } from "../ui"

interface ProfileSetupModalProps {
  isOpen: boolean
  workspaceId: string
  workspaceName: string
  currentProfile?: {
    displayName: string | null
    title: string | null
  } | null
  onComplete: (profile: { displayName: string; title?: string }) => void
  onSkip?: () => void
  canSkip?: boolean
}

export function ProfileSetupModal({
  isOpen,
  workspaceId,
  workspaceName,
  currentProfile,
  onComplete,
  onSkip,
  canSkip = false,
}: ProfileSetupModalProps) {
  const [displayName, setDisplayName] = useState(currentProfile?.displayName || "")
  const [title, setTitle] = useState(currentProfile?.title || "")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Sync state when modal opens or profile changes
  useEffect(() => {
    if (isOpen) {
      setDisplayName(currentProfile?.displayName || "")
      setTitle(currentProfile?.title || "")
      setError(null)
      nameInputRef.current?.focus()
    }
  }, [isOpen, currentProfile])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedName = displayName.trim()
    if (!trimmedName) {
      setError("Please enter a display name")
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/workspace/${workspaceId}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          displayName: trimmedName,
          title: title.trim() || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to save profile")
      }

      onComplete({ displayName: trimmedName, title: title.trim() || undefined })
    } catch (err: any) {
      setError(err.message || "Failed to save profile")
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-md mx-4 rounded-xl shadow-2xl overflow-hidden"
        style={{ background: "var(--bg-primary)" }}
      >
        {/* Header */}
        <div className="p-6 pb-4">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: "var(--gradient-accent)" }}
            >
              {workspaceName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                {currentProfile?.displayName ? "Edit your profile" : "Set up your profile"}
              </h2>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                for {workspaceName}
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 pb-6">
          {/* Preview */}
          <div className="flex items-center gap-3 p-3 rounded-lg mb-6" style={{ background: "var(--bg-secondary)" }}>
            <Avatar name={displayName || "?"} size="lg" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                {displayName || "Your name"}
              </div>
              {title && (
                <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                  {title}
                </div>
              )}
            </div>
          </div>

          {/* Display Name */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
              <span className="flex items-center gap-1.5">
                <User className="h-4 w-4" />
                Display Name
              </span>
            </label>
            <input
              ref={nameInputRef}
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How should we call you?"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-subtle)",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent-primary)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border-subtle)")}
            />
          </div>

          {/* Title */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
              <span className="flex items-center gap-1.5">
                <Briefcase className="h-4 w-4" />
                Title <span style={{ color: "var(--text-muted)" }}>(optional)</span>
              </span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Staff Engineer, CTO, Designer"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-subtle)",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent-primary)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border-subtle)")}
            />
          </div>

          {error && (
            <div
              className="mb-4 px-3 py-2 rounded-lg text-sm"
              style={{ background: "rgba(239, 68, 68, 0.1)", color: "var(--error)" }}
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            {canSkip && onSkip && (
              <Button variant="ghost" onClick={onSkip} disabled={isSaving}>
                Skip for now
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={isSaving || !displayName.trim()}>
              {isSaving ? (
                <>
                  <Spinner size="sm" />
                  Saving...
                </>
              ) : (
                "Save Profile"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
