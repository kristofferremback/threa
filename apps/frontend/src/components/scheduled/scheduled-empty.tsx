import { Clock } from "lucide-react"

export function ScheduledEmpty() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
      <Clock className="h-10 w-10" />
      <p className="text-sm">No scheduled messages</p>
      <p className="text-xs">Schedule a message from the composer to see it here</p>
    </div>
  )
}
