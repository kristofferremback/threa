import { useState } from "react"
import { CornerDownRight } from "lucide-react"
import type { StreamEvent, MessagesMovedEventPayload } from "@threa/types"
import { useActors } from "@/hooks"
import { MovedMessagesDrawer } from "./moved-messages-drawer"

interface MessagesMovedEventProps {
  event: StreamEvent
  workspaceId: string
  streamId: string
}

/**
 * Source-side `messages:moved` tombstone. Renders as a single line —
 * "Actor moved N messages" — that opens the move drill-in drawer.
 *
 * The destination-side row is intentionally NOT rendered: at the
 * destination the user already sees the moved messages themselves, plus
 * a per-message origin badge (`MovedFromIndicator`) and a "Show move
 * details" entry on each moved message's context menu — duplicating the
 * tombstone inline there would be visual noise on top of the messages
 * the user is already looking at. The `stream_events` row is still
 * cached in IDB so the per-message context-menu drill-in can find it
 * via `movedFrom.moveTombstoneId`.
 */
export function MessagesMovedEvent({ event, workspaceId, streamId }: MessagesMovedEventProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Always called so hook order is stable, even though we may early-return
  // for destination rows below. Cost is one IDB subscription per source-
  // side tombstone in the timeline (typically rare).
  const actors = useActors(workspaceId)

  const payload = event.payload as MessagesMovedEventPayload
  if (streamId === payload.destinationStreamId) return null

  const moverName = actors.getActorName(event.actorId, event.actorType)
  const count = payload.messages.length
  const noun = count === 1 ? "message" : "messages"

  return (
    <>
      <div className="py-2 px-3 sm:px-6 text-center">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-1.5 hover:underline underline-offset-2"
          aria-label={`Show ${count} moved ${noun}`}
        >
          <CornerDownRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium">{moverName}</span> moved {count} {noun}
          </span>
        </button>
      </div>
      {drawerOpen && (
        <MovedMessagesDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          event={event}
          workspaceId={workspaceId}
          currentStreamId={streamId}
        />
      )}
    </>
  )
}
