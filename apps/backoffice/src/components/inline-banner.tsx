import { type ReactNode } from "react"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Inline status banner used inside form/section bodies. Distinct from a toast
 * (which is transient and global) — these live in the layout and document the
 * outcome of the surrounding action.
 *
 * Wired as a live region so screen readers announce async success/error
 * outcomes without needing focus changes. Errors use `assertive` so they
 * interrupt; successes are `polite`.
 */
export function InlineBanner({
  tone,
  className,
  children,
}: {
  tone: "success" | "error"
  className?: string
  children: ReactNode
}) {
  const Icon = tone === "success" ? CheckCircle2 : AlertTriangle
  const isError = tone === "error"
  const toneClasses = isError
    ? "border-destructive/40 bg-destructive/5 text-destructive"
    : "border-primary/30 bg-accent/40 text-accent-foreground"
  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
      className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", toneClasses, className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  )
}
