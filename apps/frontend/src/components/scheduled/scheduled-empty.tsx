import { CalendarClock } from "lucide-react"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

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
    <Empty className="border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarClock />
        </EmptyMedia>
        <EmptyTitle>{copy.title}</EmptyTitle>
        <EmptyDescription>{copy.hint}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
