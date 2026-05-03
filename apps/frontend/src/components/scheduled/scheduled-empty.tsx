import { CalendarClock } from "lucide-react"

interface ScheduledEmptyProps {
  status: "pending" | "sent" | "failed" | "cancelled"
}

export function ScheduledEmpty({ status }: ScheduledEmptyProps) {
  const copy = {
    pending: {
      title: "No scheduled messages",
      hint: "Use the schedule picker next to the send button to queue a message for later.",
    },
    sent: {
      title: "Nothing sent yet",
      hint: "Scheduled messages move here once they're delivered.",
    },
    failed: {
      title: "No failed messages",
      hint: "Messages that hit a delivery problem will surface here so you can resend.",
    },
    cancelled: {
      title: "No cancelled messages",
      hint: "Messages you cancel before they fire show up here.",
    },
  }[status]

  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center text-muted-foreground">
      <CalendarClock className="h-8 w-8 opacity-50" />
      <div className="text-sm font-medium">{copy.title}</div>
      <p className="max-w-sm text-xs">{copy.hint}</p>
    </div>
  )
}
