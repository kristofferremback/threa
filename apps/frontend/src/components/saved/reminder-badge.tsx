import { useEffect, useState } from "react"
import { Bell, BellOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatFutureTime } from "@/lib/dates"
import { usePreferences } from "@/contexts/preferences-context"

interface ReminderBadgeProps {
  /** ISO date string; null when no reminder is set. */
  remindAt: string | null
  /** ISO date string set when the reminder has already fired. */
  reminderSentAt: string | null
  className?: string
}

/**
 * Small inline badge showing when a reminder is scheduled or when the last
 * fire happened. Re-renders every 30s while pending so relative labels stay
 * fresh without polling the server.
 */
export function ReminderBadge({ remindAt, reminderSentAt, className }: ReminderBadgeProps) {
  const [, forceTick] = useState(0)
  const { preferences } = usePreferences()

  useEffect(() => {
    if (!remindAt || reminderSentAt) return
    const interval = setInterval(() => forceTick((n) => n + 1), 30_000)
    return () => clearInterval(interval)
  }, [remindAt, reminderSentAt])

  if (reminderSentAt) {
    return (
      <span
        className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground/80", className)}
        title="Reminder already delivered"
      >
        <BellOff className="h-3 w-3" />
        reminded
      </span>
    )
  }

  if (!remindAt) return null

  const date = new Date(remindAt)
  const label = formatFutureTime(date, new Date(), preferences ?? undefined)

  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}
      title={date.toLocaleString()}
    >
      <Bell className="h-3 w-3" />
      {label}
    </span>
  )
}
