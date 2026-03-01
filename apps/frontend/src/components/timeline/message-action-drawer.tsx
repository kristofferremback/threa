import { useCallback } from "react"
import { Link } from "react-router-dom"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { cn } from "@/lib/utils"
import { type MessageActionContext, type MessageAction, getVisibleActions } from "./message-actions"

interface MessageActionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  context: MessageActionContext
  /** Author display name for the message preview */
  authorName: string
}

export function MessageActionDrawer({ open, onOpenChange, context, authorName }: MessageActionDrawerProps) {
  const actions = getVisibleActions(context)

  const handleAction = useCallback(
    (action: MessageAction) => {
      onOpenChange(false)
      action.action?.(context)
    },
    [context, onOpenChange]
  )

  const handleSubAction = useCallback(
    (sub: { action: (ctx: MessageActionContext) => void | Promise<void> }) => {
      onOpenChange(false)
      sub.action(context)
    },
    [context, onOpenChange]
  )

  if (!open && actions.length === 0) return null

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85dvh]">
        {/* Accessible title (visually hidden) */}
        <DrawerTitle className="sr-only">Message actions</DrawerTitle>

        {/* Message preview */}
        <div className="px-4 pt-1 pb-3">
          <div className="rounded-xl bg-muted/60 px-3.5 py-2.5">
            <p className="text-[13px] font-medium text-muted-foreground mb-0.5">{authorName}</p>
            <div className="text-sm text-foreground/80 line-clamp-2 leading-snug">
              <MarkdownContent content={context.contentMarkdown} />
            </div>
          </div>
        </div>

        {/* Action list */}
        <div className="px-2 pb-[max(12px,env(safe-area-inset-bottom))]">
          {actions.map((action) => {
            // Flatten sub-actions into separate rows (no nested menus on mobile)
            if (action.subActions && action.subActions.length > 0) {
              return (
                <div key={action.id}>
                  {action.separatorBefore && <Divider />}
                  {action.subActions.map((sub) => {
                    const SubIcon = sub.icon
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm active:bg-muted/80 transition-colors"
                        onClick={() => handleSubAction(sub)}
                      >
                        <SubIcon className="h-[18px] w-[18px] text-muted-foreground shrink-0" />
                        <span>{sub.label}</span>
                      </button>
                    )
                  })}
                </div>
              )
            }

            const Icon = action.icon
            const isDestructive = action.variant === "destructive"
            const href = action.getHref?.(context)

            const rowClassName = cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
              isDestructive ? "text-destructive active:bg-destructive/10" : "active:bg-muted/80"
            )
            const iconEl = (
              <Icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0",
                  isDestructive ? "text-destructive" : "text-muted-foreground"
                )}
              />
            )

            return (
              <div key={action.id}>
                {action.separatorBefore && <Divider />}
                {href ? (
                  <Link to={href} className={rowClassName} onClick={() => onOpenChange(false)}>
                    {iconEl}
                    <span>{action.label}</span>
                  </Link>
                ) : (
                  <button type="button" className={rowClassName} onClick={() => handleAction(action)}>
                    {iconEl}
                    <span>{action.label}</span>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function Divider() {
  return <div className="mx-3 my-1 border-t border-border/50" />
}
