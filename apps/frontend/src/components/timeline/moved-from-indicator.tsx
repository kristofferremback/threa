import { CornerDownRight } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { RelativeTime } from "@/components/relative-time"
import { useActors } from "@/hooks"

interface MovedFromIndicatorProps {
  workspaceId: string
  movedFrom: {
    sourceStreamId: string
    movedAt: string
    movedBy: string
  }
}

/**
 * Subtle "moved here" badge shown next to a message's timestamp when the
 * message was relocated into this stream by a move-to-thread operation.
 * The icon doubles as the visual identity of the move action everywhere
 * (context menus + tombstones use the same `CornerDownRight`).
 */
export function MovedFromIndicator({ workspaceId, movedFrom }: MovedFromIndicatorProps) {
  const { getActorName } = useActors(workspaceId)
  const moverName = getActorName(movedFrom.movedBy, "user")

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center text-muted-foreground hover:text-foreground cursor-default"
          aria-label="Moved from another stream"
        >
          <CornerDownRight className="h-3 w-3" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        Moved here by {moverName} <RelativeTime date={movedFrom.movedAt} />
      </TooltipContent>
    </Tooltip>
  )
}
