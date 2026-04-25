import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDown, EllipsisVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  type GroupedActionItem,
  type MessageAction,
  type MessageActionContext,
  getVisibleActions,
  groupVisibleActions,
  resolveActionLabel,
} from "./message-actions"

interface MessageContextMenuProps {
  context: MessageActionContext
}

export function MessageContextMenu({ context }: MessageContextMenuProps) {
  const [open, setOpen] = useState(false)
  const actions = getVisibleActions(context)
  const groupedActions = useMemo(() => groupVisibleActions(actions), [actions])

  if (actions.length === 0) return null

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-6 w-6 shadow-sm hover:border-primary/30 text-muted-foreground shrink-0"
          aria-label="Message actions"
        >
          <EllipsisVertical className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[200px]"
        // Prevent Radix from restoring focus to the trigger button on close.
        // Without this, selecting "Edit message" focuses the editor via autoFocus,
        // then Radix's cleanup steals focus back to the trigger button.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {groupedActions.map((item) => (
          <GroupedItem
            key={item.kind === "single" ? item.action.id : item.primary.id}
            item={item}
            context={context}
            onClose={() => setOpen(false)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function GroupedItem({
  item,
  context,
  onClose,
}: {
  item: GroupedActionItem
  context: MessageActionContext
  onClose: () => void
}) {
  if (item.kind === "single") {
    return <SingleAction action={item.action} context={context} onClose={onClose} showSeparatorBefore />
  }

  // Split-button group: render the primary as a normal item, then immediately
  // a sub-menu with a chevron-only trigger holding the alternatives. Same
  // shape as the mobile drawer (driven by `groupVisibleActions`); the desktop
  // dropdown surface uses Radix sub-menus instead of a portalled popover.
  const { primary, alternatives } = item
  const PrimaryIcon = primary.icon
  const isDestructive = primary.variant === "destructive"

  return (
    <>
      {primary.separatorBefore && <DropdownMenuSeparator />}
      <div className="flex items-stretch">
        <DropdownMenuItem
          className={cn(
            "flex-1 gap-2 cursor-pointer rounded-r-none",
            isDestructive && "text-destructive focus:text-destructive"
          )}
          onSelect={() => {
            onClose()
            primary.action?.(context)
          }}
        >
          <PrimaryIcon className={cn("h-4 w-4", isDestructive ? "" : "text-muted-foreground")} />
          {resolveActionLabel(primary, context)}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            className="px-2 cursor-pointer rounded-l-none border-l border-border/50 [&>svg.lucide-chevron-right]:hidden"
            aria-label={`More ${primary.groupId ?? "options"}`}
          >
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {alternatives.map((alt) => {
              const AltIcon = alt.icon
              return (
                <DropdownMenuItem
                  key={alt.id}
                  className="gap-2 cursor-pointer"
                  onSelect={() => {
                    onClose()
                    alt.action?.(context)
                  }}
                >
                  <AltIcon className="h-4 w-4 text-muted-foreground" />
                  {resolveActionLabel(alt, context)}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </div>
    </>
  )
}

function SingleAction({
  action,
  context,
  onClose,
  showSeparatorBefore,
}: {
  action: MessageAction
  context: MessageActionContext
  onClose: () => void
  showSeparatorBefore?: boolean
}) {
  const Icon = action.icon
  const href = action.getHref?.(context)
  const separator = showSeparatorBefore && action.separatorBefore ? <DropdownMenuSeparator /> : null

  if (href) {
    return (
      <>
        {separator}
        <DropdownMenuItem asChild className="gap-2 cursor-pointer">
          <Link to={href} onClick={onClose}>
            <Icon className="h-4 w-4 text-muted-foreground" />
            {resolveActionLabel(action, context)}
          </Link>
        </DropdownMenuItem>
      </>
    )
  }

  const isDestructive = action.variant === "destructive"

  return (
    <>
      {separator}
      <DropdownMenuItem
        className={
          isDestructive ? "gap-2 cursor-pointer text-destructive focus:text-destructive" : "gap-2 cursor-pointer"
        }
        onSelect={() => {
          onClose()
          action.action?.(context)
        }}
      >
        <Icon className={isDestructive ? "h-4 w-4" : "h-4 w-4 text-muted-foreground"} />
        {resolveActionLabel(action, context)}
      </DropdownMenuItem>
    </>
  )
}
