import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ReactionDetailsContent } from "./reaction-details"

interface AllReactionsPopoverProps {
  reactions: Record<string, string[]>
  workspaceId: string
  children: React.ReactNode
}

export function AllReactionsPopover({ reactions, workspaceId, children }: AllReactionsPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[260px] p-0">
        <ReactionDetailsContent reactions={reactions} workspaceId={workspaceId} />
      </PopoverContent>
    </Popover>
  )
}
