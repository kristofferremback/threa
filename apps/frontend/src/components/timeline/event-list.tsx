import type { StreamEvent } from "@/types/domain"
import { EventItem } from "./event-item"

interface EventListProps {
  events: StreamEvent[]
  isLoading: boolean
  workspaceId: string
  streamId: string
}

export function EventList({ events, isLoading, workspaceId, streamId }: EventListProps) {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">No messages yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Start the conversation by sending a message below
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 p-4">
      {events.map((event) => (
        <EventItem key={event.id} event={event} workspaceId={workspaceId} streamId={streamId} />
      ))}
    </div>
  )
}
