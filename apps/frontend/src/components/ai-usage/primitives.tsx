import { Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground", className)}>
      {children}
    </span>
  )
}

export function Stat({
  label,
  value,
  hint,
  info,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  info?: React.ReactNode
}) {
  return (
    <div className="min-w-0 space-y-1">
      <SectionLabel>
        {label}
        {info && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="ml-1 inline-flex rounded-sm align-middle text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="How this is calculated"
              >
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              align="start"
              className="max-w-xs text-xs font-normal normal-case leading-relaxed tracking-normal"
            >
              {info}
            </TooltipContent>
          </Tooltip>
        )}
      </SectionLabel>
      <div className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}
