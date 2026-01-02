import type { StreamEvent } from "@threa/types"

interface SystemEventProps {
  event: StreamEvent
}

export function SystemEvent({ event }: SystemEventProps) {
  const message = getSystemMessage(event)

  return (
    <div className="py-2 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

function getSystemMessage(event: StreamEvent): string {
  switch (event.eventType) {
    case "thread_created":
      return "A thread was started"
    case "stream_archived":
      return "This thread has been sealed in the labyrinth"
    case "stream_unarchived":
      return "This thread has been restored from the labyrinth"
    default:
      return `System event: ${event.eventType}`
  }
}
