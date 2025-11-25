import { MessageCircle, Sparkles } from "lucide-react"

export function LoginScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center" style={{ background: "var(--gradient-bg)" }}>
      <div className="flex flex-col items-center gap-8 text-center max-w-md px-6 animate-fade-in">
        {/* Logo */}
        <div className="relative">
          <div
            className="absolute inset-0 blur-3xl opacity-30"
            style={{ background: "var(--gradient-accent)", transform: "scale(2)" }}
          />
          <div className="relative flex items-center gap-3">
            <MessageCircle className="h-12 w-12" style={{ color: "var(--accent-primary)" }} />
            <span className="text-4xl font-bold tracking-tight" style={{ fontFamily: "var(--font-sans)" }}>
              threa
            </span>
          </div>
        </div>

        {/* Tagline */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            Conversations that flow
          </h1>
          <p style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
            A modern chat platform built for teams who value context and clarity.
          </p>
        </div>

        {/* Login Button */}
        <button
          onClick={() => (window.location.href = "/api/auth/login")}
          className="group relative overflow-hidden rounded-xl px-8 py-3.5 font-medium transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: "var(--gradient-accent)",
            color: "white",
            boxShadow: "0 0 30px var(--accent-glow)",
          }}
        >
          <span className="relative z-10 flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Continue with WorkOS
          </span>
          <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>

        {/* Footer */}
        <p className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          Enterprise-grade authentication
        </p>
      </div>
    </div>
  )
}

