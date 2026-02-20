import { useState } from "react"
import { Link } from "react-router-dom"
import { EllipsisVertical } from "lucide-react"
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
import { type MessageAction, type MessageActionContext, getVisibleActions } from "./message-actions"

interface MessageContextMenuProps {
  context: MessageActionContext
}

export function MessageContextMenu({ context }: MessageContextMenuProps) {
  const [open, setOpen] = useState(false)
  const actions = getVisibleActions(context)

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
        {actions.map((action, index) => (
          <ActionItem
            key={action.id}
            action={action}
            context={context}
            onClose={() => setOpen(false)}
            showSeparatorBefore={action.separatorBefore && index > 0}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ActionItem({
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

  const separator = showSeparatorBefore ? <DropdownMenuSeparator /> : null

  if (action.subActions && action.subActions.length > 0) {
    return (
      <>
        {separator}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2 cursor-pointer">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {action.label}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {action.subActions.map((sub) => {
              const SubIcon = sub.icon
              return (
                <DropdownMenuItem
                  key={sub.id}
                  className="gap-2 cursor-pointer"
                  onSelect={() => {
                    sub.action(context)
                    onClose()
                  }}
                >
                  <SubIcon className="h-4 w-4 text-muted-foreground" />
                  {sub.label}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </>
    )
  }

  if (href) {
    return (
      <>
        {separator}
        <DropdownMenuItem asChild className="gap-2 cursor-pointer">
          <Link to={href} onClick={onClose}>
            <Icon className="h-4 w-4 text-muted-foreground" />
            {action.label}
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
          action.action?.(context)
          onClose()
        }}
      >
        <Icon className={isDestructive ? "h-4 w-4" : "h-4 w-4 text-muted-foreground"} />
        {action.label}
      </DropdownMenuItem>
    </>
  )
}
