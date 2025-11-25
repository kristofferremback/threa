import { Building2, Plus } from "lucide-react"
import { Button } from "../../ui"

interface NoWorkspaceScreenProps {
  onCreateWorkspace: () => void
}

export function NoWorkspaceScreen({ onCreateWorkspace }: NoWorkspaceScreenProps) {
  return (
    <div className="flex h-screen w-full items-center justify-center" style={{ background: "var(--gradient-bg)" }}>
      <div className="flex flex-col items-center gap-8 text-center max-w-lg px-6 animate-fade-in">
        {/* Icon */}
        <div
          className="p-6 rounded-2xl"
          style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)" }}
        >
          <Building2 className="h-12 w-12" style={{ color: "var(--text-secondary)" }} />
        </div>

        {/* Message */}
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            No workspace yet
          </h1>
          <p style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
            You're not a member of any workspace. Create a new one to get started, or ask your administrator to add you
            to an existing workspace.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={onCreateWorkspace}
            className="group relative overflow-hidden rounded-xl px-6 py-3 font-medium transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: "var(--gradient-accent)",
              color: "white",
              boxShadow: "0 0 20px var(--accent-glow)",
            }}
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              <Plus className="h-4 w-4" />
              Create Workspace
            </span>
          </button>

          <Button variant="secondary" onClick={() => (window.location.href = "/api/auth/logout")}>
            Sign out
          </Button>
        </div>

        {/* Help text */}
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Need help? Contact your organization admin.
        </p>
      </div>
    </div>
  )
}


