import { type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Backoffice page sections use an uppercase "eyebrow" label instead of a
 * boxed CardHeader — it borrows the same micro-label pattern from the main
 * app (`text-[11px] font-semibold tracking-[0.18em]`) and lets sections be
 * separated by whitespace rather than by nested containers.
 */
export function Section({
  label,
  description,
  actions,
  className,
  children,
}: {
  label: string
  description?: ReactNode
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}
