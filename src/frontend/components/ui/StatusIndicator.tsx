import { clsx } from "clsx"

type StatusType = "online" | "away" | "busy" | "offline"

interface StatusIndicatorProps {
  status: StatusType
  size?: "sm" | "md" | "lg"
  className?: string
}

const statusColors: Record<StatusType, string> = {
  online: "var(--success)",
  away: "var(--warning)",
  busy: "var(--danger)",
  offline: "var(--text-muted)",
}

const sizeClasses = {
  sm: "w-2 h-2",
  md: "w-2.5 h-2.5",
  lg: "w-3 h-3",
}

export function StatusIndicator({ status, size = "md", className }: StatusIndicatorProps) {
  return (
    <span
      className={clsx("rounded-full inline-block", sizeClasses[size], className)}
      style={{ background: statusColors[status] }}
      title={status.charAt(0).toUpperCase() + status.slice(1)}
    />
  )
}
