import { Link } from "react-router-dom"
import { getStepLabel, type MessageAgentActivity } from "@/hooks"
import { useTrace } from "@/contexts"
import { cn } from "@/lib/utils"

interface ActivityPillProps {
  activity: MessageAgentActivity
  className?: string
}

/**
 * "Ariadne is thinking…" indicator below a trigger message. Visually echoes
 * ThreadCard's 2px gold left-line and sits in the same footer slot, so the
 * transition from thinking → first-reply-posted is a single continuous gold
 * thread extending downward rather than two different shapes swapping places.
 *
 * A shimmer glides down the line while the session is active; the text itself
 * is italic and softly tinted, reading as ephemeral state rather than persisted
 * content. Clicking opens the trace (unchanged).
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
        "group/thinking relative mt-2 flex items-center py-1 pl-3 pr-2",
        "text-xs transition-colors",
        className
      )}
      aria-label={`${activity.personaName} ${label}`}
    >
      {/* Base gold line — matches ThreadCard's `before:` left-line so the
          pill→card handoff looks like one continuous thread extending down. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-0 top-[-4px] bottom-[-2px] w-[2px] overflow-hidden rounded-full",
          "bg-primary/30 group-hover/thinking:bg-primary/50 transition-colors"
        )}
      >
        {/* Shimmer that travels down the line while the session weaves */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-5 animate-thread-weave bg-gradient-to-b from-transparent via-primary to-transparent opacity-80"
        />
      </span>
      <span className="truncate max-w-[280px] italic text-primary/75 group-hover/thinking:text-primary">
        <span className="not-italic font-medium text-primary/95">{activity.personaName}</span>{" "}
        <span className="text-primary/65 group-hover/thinking:text-primary/90">{label}</span>
      </span>
    </Link>
  )
}
