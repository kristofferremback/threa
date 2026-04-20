import { Link } from "react-router-dom"
import { getStepLabel, type MessageAgentActivity } from "@/hooks"
import { useTrace } from "@/contexts"
import { cn } from "@/lib/utils"

interface ActivityPillProps {
  activity: MessageAgentActivity
  className?: string
}

/**
 * Inline pill shown next to the author name while an agent session triggered
 * by this message is still running. Replaces the old footer "{persona} is
 * thinking…" text link — moving the live signal up into the header row means
 * it survives the message-grouping collapse (continuations don't render a
 * header, but the head's pill stays visible for the whole run).
 */
/**
 * Normalize a label so it ends with exactly one ellipsis, regardless of
 * whether the upstream source (step-config or backend substep) already
 * terminates with ASCII `...`, Unicode `…`, or nothing. Without this the
 * pill double-stacks ellipses into "thinking...…" (three dots + one) when
 * the step-config labels already carry trailing `...`.
 */
function withTrailingEllipsis(text: string): string {
  return text.replace(/[.…\s]+$/u, "") + "…"
}

export function ActivityPill({ activity, className }: ActivityPillProps) {
  const { getTraceUrl } = useTrace()

  const label = activity.substep
    ? withTrailingEllipsis(activity.substep)
    : `is ${withTrailingEllipsis(getStepLabel(activity.currentStepType).toLowerCase())}`

  return (
    <Link
      to={getTraceUrl(activity.sessionId)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-primary/[0.08] px-2 py-0.5",
        "text-[11px] font-medium text-primary/90 hover:bg-primary/[0.14] hover:text-primary transition-colors",
        className
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
      <span className="truncate max-w-[220px]">
        <span className="text-primary/70">{activity.personaName}</span> {label}
      </span>
    </Link>
  )
}
