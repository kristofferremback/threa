import { type ReactNode } from "react"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Inline status banner used inside form/section bodies. Distinct from a toast
 * (which is transient and global) — these live in the layout and document the
 * outcome of the surrounding action.
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
  const toneClasses =
    tone === "success"
      ? "border-primary/30 bg-accent/40 text-accent-foreground"
      : "border-destructive/40 bg-destructive/5 text-destructive"
  return (
    <div className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", toneClasses, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  )
}
