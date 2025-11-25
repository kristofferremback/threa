import { clsx } from "clsx"

type Status = "online" | "offline" | "away" | "busy"

interface StatusIndicatorProps {
  status: Status
  pulse?: boolean
  size?: "sm" | "md"
  label?: string
}

const statusColors: Record<Status, string> = {
  online: "var(--success)",
  offline: "var(--danger)",
  away: "var(--warning)",
  busy: "var(--danger)",
}

const statusLabels: Record<Status, string> = {
  online: "live",
  offline: "offline",
  away: "away",
  busy: "busy",
}

export function StatusIndicator({ status, pulse = true, size = "sm", label }: StatusIndicatorProps) {
  const dotSize = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5"

  return (
    <div className="flex items-center gap-2">
      <div
        className={clsx("rounded-full", dotSize, pulse && status === "online" && "animate-pulse")}
        style={{ background: statusColors[status] }}
      />
      {label !== undefined ? (
        <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {label}
        </span>
      ) : (
        <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {statusLabels[status]}
        </span>
      )}
    </div>
  )
}


