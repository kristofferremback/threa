import { MessageCircle } from "lucide-react"
import { Spinner } from "../../ui"

export function LoadingScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center" style={{ background: "var(--gradient-bg)" }}>
      <div className="flex flex-col items-center gap-6 text-center animate-fade-in">
        <div className="relative">
          <div className="absolute inset-0 blur-2xl opacity-50" style={{ background: "var(--gradient-accent)" }} />
          <MessageCircle className="h-16 w-16 relative" style={{ color: "var(--accent-primary)" }} />
        </div>
        <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
          <Spinner size="sm" />
          <span style={{ fontFamily: "var(--font-mono)" }}>Initializing...</span>
        </div>
      </div>
    </div>
  )
}
