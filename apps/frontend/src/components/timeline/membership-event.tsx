import type { StreamEvent } from "@threa/types"
import { useActors } from "@/hooks"

interface MembershipEventProps {
  event: StreamEvent
  workspaceId: string
}

export function MembershipEvent({ event, workspaceId }: MembershipEventProps) {
  const { getActorName } = useActors(workspaceId)
  const action = event.eventType === "member_joined" ? "joined" : "left"
  const actorName = getActorName(event.actorId, event.actorType)

  return (
    <div className="py-2 text-center">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium">{actorName}</span> {action} the conversation
      </p>
    </div>
  )
}
