import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface MentionIndicatorProps {
  count: number
  className?: string
}

export function MentionIndicator({ count, className }: MentionIndicatorProps) {
  if (count <= 0) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("flex-shrink-0 text-[11px] font-bold leading-none text-destructive cursor-default", className)}
        >
          @
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {count === 1 ? "1 mention" : `${count} mentions`}
      </TooltipContent>
    </Tooltip>
  )
}
