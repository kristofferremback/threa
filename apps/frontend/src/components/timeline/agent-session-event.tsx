import { Link } from "react-router-dom"
import { Check, X, Loader2 } from "lucide-react"
import type {
  StreamEvent,
  AgentSessionRerunContext,
  AgentSessionStartedPayload,
  AgentSessionCompletedPayload,
  AgentSessionFailedPayload,
  AgentSessionDeletedPayload,
} from "@threa/types"
import { useTrace } from "@/contexts"
import { RelativeTime } from "@/components/relative-time"
import { formatDuration } from "@/lib/dates"

interface AgentSessionEventProps {
  events: StreamEvent[]
  sessionVersion?: number
  /** Live progress counts from parent (via useAgentActivity hook) */
  liveCounts?: { stepCount: number; messageCount: number }
}

type SessionStatus = "running" | "completed" | "failed" | "deleted"

interface StatusConfig {
  title: string
  subtitle: string
  icon: React.ReactNode
  borderColor: string
  bgColor: string
  hoverBgColor: string
  titleColor?: string
  timestamp: string | null
}

function deriveStatus(events: StreamEvent[]): {
  status: SessionStatus
  sessionId: string
  startedPayload: AgentSessionStartedPayload | null
  completedPayload: AgentSessionCompletedPayload | null
  failedPayload: AgentSessionFailedPayload | null
  deletedPayload: AgentSessionDeletedPayload | null
} {
  let startedPayload: AgentSessionStartedPayload | null = null
  let completedPayload: AgentSessionCompletedPayload | null = null
  let failedPayload: AgentSessionFailedPayload | null = null
  let deletedPayload: AgentSessionDeletedPayload | null = null
  let sessionId = ""

  for (const event of events) {
    const payload = event.payload as { sessionId?: string }
    if (payload.sessionId) sessionId = payload.sessionId

    switch (event.eventType) {
      case "agent_session:started":
        startedPayload = event.payload as AgentSessionStartedPayload
        break
      case "agent_session:completed":
        completedPayload = event.payload as AgentSessionCompletedPayload
        break
      case "agent_session:failed":
        failedPayload = event.payload as AgentSessionFailedPayload
        break
      case "agent_session:deleted":
        deletedPayload = event.payload as AgentSessionDeletedPayload
        break
    }
  }

  // Deleted takes precedence over completed/failed because it is a terminal superseding action.
  // Completed takes precedence over failed (intermediate failures can be recovered).
  let status: SessionStatus
  if (deletedPayload) {
    status = "deleted"
  } else if (completedPayload) {
    status = "completed"
  } else if (failedPayload) {
    status = "failed"
  } else {
    status = "running"
  }

  return { status, sessionId, startedPayload, completedPayload, failedPayload, deletedPayload }
}

function buildStatusConfig(
  status: SessionStatus,
  startedPayload: AgentSessionStartedPayload | null,
  completedPayload: AgentSessionCompletedPayload | null,
  failedPayload: AgentSessionFailedPayload | null,
  deletedPayload: AgentSessionDeletedPayload | null,
  liveCounts: { stepCount: number; messageCount: number } | undefined
): StatusConfig {
  const rerunReasonLabel = formatRerunReasonLabel(startedPayload?.rerunContext)
  const rerunReasonDetail = formatRerunReasonDetail(startedPayload?.rerunContext)

  switch (status) {
    case "deleted":
      return {
        title: "Session deleted",
        subtitle: "This session was removed because its invoking message was deleted.",
        icon: (
          <div className="w-5 h-5 rounded-full flex items-center justify-center bg-[hsl(210_15%_55%/0.15)]">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        ),
        borderColor: "hsl(var(--border))",
        bgColor: "hsl(var(--muted) / 0.4)",
        hoverBgColor: "hsl(var(--muted) / 0.6)",
        timestamp: deletedPayload?.deletedAt ?? startedPayload?.startedAt ?? null,
      }

    case "completed": {
      const parts: string[] = []
      if (rerunReasonLabel) {
        parts.push(rerunReasonLabel)
      }
      if (rerunReasonDetail) {
        parts.push(rerunReasonDetail)
      }
      if (completedPayload) {
        parts.push(`${completedPayload.stepCount} ${completedPayload.stepCount === 1 ? "step" : "steps"}`)
        parts.push(formatDuration(completedPayload.duration))
        parts.push(
          `${completedPayload.messageCount} ${completedPayload.messageCount === 1 ? "message" : "messages"} sent`
        )
      }
      return {
        title: "Session complete",
        subtitle: parts.join(" • "),
        icon: (
          <div className="w-5 h-5 rounded-full flex items-center justify-center bg-[hsl(142_76%_36%/0.15)]">
            <Check className="w-3.5 h-3.5 text-[hsl(142,76%,36%)]" />
          </div>
        ),
        borderColor: "hsl(var(--border))",
        bgColor: "hsl(var(--muted) / 0.5)",
        hoverBgColor: "hsl(var(--muted) / 0.7)",
        timestamp: completedPayload?.completedAt ?? startedPayload?.startedAt ?? null,
      }
    }
    case "failed": {
      const parts: string[] = []
      if (rerunReasonLabel) {
        parts.push(rerunReasonLabel)
      }
      if (rerunReasonDetail) {
        parts.push(rerunReasonDetail)
      }
      if (failedPayload) {
        parts.push(`${failedPayload.stepCount} ${failedPayload.stepCount === 1 ? "step" : "steps"}`)
      }
      parts.push("Error during execution")
      return {
        title: "Session failed",
        subtitle: parts.join(" • "),
        icon: (
          <div className="w-5 h-5 rounded-full flex items-center justify-center bg-[hsl(0_84%_60%/0.15)]">
            <X className="w-3.5 h-3.5 text-[hsl(0,84%,60%)]" />
          </div>
        ),
        borderColor: "hsl(0 84% 60% / 0.3)",
        bgColor: "hsl(0 84% 60% / 0.05)",
        hoverBgColor: "hsl(0 84% 60% / 0.08)",
        titleColor: "hsl(0 84% 60%)",
        timestamp: failedPayload?.failedAt ?? startedPayload?.startedAt ?? null,
      }
    }
    case "running": {
      const personaName = startedPayload?.personaName ?? "Agent"
      const stepCount = liveCounts?.stepCount ?? 0
      const messageCount = liveCounts?.messageCount ?? 0
      const parts: string[] = []
      if (rerunReasonLabel) {
        parts.push(rerunReasonLabel)
      }
      if (rerunReasonDetail) {
        parts.push(rerunReasonDetail)
      }
      parts.push(`${stepCount} ${stepCount === 1 ? "step" : "steps"}`)
      parts.push(`${messageCount} ${messageCount === 1 ? "message" : "messages"} sent`)
      return {
        title: `${personaName} is working...`,
        subtitle: parts.join(" • "),
        icon: (
          <div className="w-5 h-5 rounded-full flex items-center justify-center bg-[hsl(var(--primary)/0.15)]">
            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
          </div>
        ),
        borderColor: "hsl(var(--border))",
        bgColor: "hsl(var(--muted) / 0.5)",
        hoverBgColor: "hsl(var(--muted) / 0.7)",
        timestamp: startedPayload?.startedAt ?? null,
      }
    }
  }
}

function formatRerunReasonLabel(rerunContext?: AgentSessionRerunContext | null): string | null {
  if (!rerunContext) return null
  switch (rerunContext.cause) {
    case "invoking_message_edited":
      return "Rerun after invoking message edit"
    case "referenced_message_edited":
      return "Rerun after follow-up message edit"
    default:
      return null
  }
}

function formatRerunReasonDetail(rerunContext?: AgentSessionRerunContext | null): string | null {
  if (!rerunContext) return null
  const after = rerunContext.editedMessageAfter?.trim()
  if (!after) return null
  const compact = after.length > 80 ? `${after.slice(0, 77)}...` : after
  return `Edited: "${compact}"`
}

export function AgentSessionEvent({ events, sessionVersion, liveCounts }: AgentSessionEventProps) {
  const { getTraceUrl } = useTrace()
  const { status, sessionId, startedPayload, completedPayload, failedPayload, deletedPayload } = deriveStatus(events)

  const config = buildStatusConfig(status, startedPayload, completedPayload, failedPayload, deletedPayload, liveCounts)

  if (!sessionId) return null

  return (
    <div className="py-3">
      <Link
        to={getTraceUrl(sessionId)}
        className="group flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] text-[13px] transition-all duration-150 no-underline"
        style={{
          background: config.bgColor,
          border: `1px solid ${config.borderColor}`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = config.hoverBgColor
          if (status === "completed") {
            e.currentTarget.style.borderColor = "hsl(var(--primary) / 0.3)"
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = config.bgColor
          e.currentTarget.style.borderColor = config.borderColor
        }}
      >
        {config.icon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-medium" style={config.titleColor ? { color: config.titleColor } : undefined}>
              {config.title}
            </div>
            {sessionVersion != null && sessionVersion > 1 && (
              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                Version {sessionVersion}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{config.subtitle || "\u00a0"}</div>
        </div>
        <div className="shrink-0 text-[11px]">
          {config.timestamp && (
            <RelativeTime date={config.timestamp} className="text-muted-foreground group-hover:hidden" />
          )}
          <span className="text-primary hidden group-hover:inline">Show trace and sources →</span>
        </div>
      </Link>
    </div>
  )
}
