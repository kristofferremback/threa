import type { StreamEvent } from "@threa/types"

interface MembershipEventProps {
  event: StreamEvent
}

export function MembershipEvent({ event }: MembershipEventProps) {
  const action = event.eventType === "member_joined" ? "joined" : "left"

  return (
    <div className="py-2 text-center">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium">{formatActorId(event.actorId)}</span> {action} the conversation
      </p>
    </div>
  )
}

function formatActorId(actorId: string | null): string {
  if (!actorId) return "Someone"
  return actorId.substring(0, 8)
}
