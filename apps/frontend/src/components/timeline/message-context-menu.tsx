import { useState } from "react"
import { Link } from "react-router-dom"
import { EllipsisVertical } from "lucide-react"
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

  // Group actions: non-copy actions first, then separator, then copy
  const regularActions = actions.filter((a) => a.id !== "copy")
  const copyAction = actions.find((a) => a.id === "copy")

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex items-center justify-center h-6 w-6 rounded-md border border-border bg-card shadow-sm hover:bg-muted hover:border-primary/30 text-muted-foreground cursor-pointer transition-all shrink-0"
          aria-label="Message actions"
        >
          <EllipsisVertical className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        {regularActions.map((action) => (
          <ActionItem key={action.id} action={action} context={context} onClose={() => setOpen(false)} />
        ))}
        {copyAction && regularActions.length > 0 && <DropdownMenuSeparator />}
        {copyAction && <ActionItem action={copyAction} context={context} onClose={() => setOpen(false)} />}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ActionItem({
  action,
  context,
  onClose,
}: {
  action: MessageAction
  context: MessageActionContext
  onClose: () => void
}) {
  const Icon = action.icon
  const href = action.getHref?.(context)

  if (action.subActions && action.subActions.length > 0) {
    return (
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
                  sub.action?.(context)
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
    )
  }

  if (href) {
    return (
      <DropdownMenuItem asChild className="gap-2 cursor-pointer">
        <Link to={href} onClick={onClose}>
          <Icon className="h-4 w-4 text-muted-foreground" />
          {action.label}
        </Link>
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenuItem
      className="gap-2 cursor-pointer"
      onSelect={() => {
        action.action?.(context)
        onClose()
      }}
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      {action.label}
    </DropdownMenuItem>
  )
}
