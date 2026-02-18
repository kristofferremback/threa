import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { RelativeTime } from "@/components/relative-time"

interface EditedIndicatorProps {
  editedAt: string
  onShowHistory: () => void
}

export function EditedIndicator({ editedAt, onShowHistory }: EditedIndicatorProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onShowHistory} className="text-xs text-muted-foreground hover:text-foreground cursor-pointer">
          (edited)
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        Edited <RelativeTime date={editedAt} />
      </TooltipContent>
    </Tooltip>
  )
}
