import type { ComponentProps, MouseEvent, ReactNode } from "react"
import { type LucideIcon, MoreHorizontal } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RelativeTime } from "@/components/relative-time"
import { Separator } from "@/components/ui/separator"
import { useSidebar } from "@/contexts"
import { cn } from "@/lib/utils"

export interface SidebarActionItem {
  id: string
  label: string
  icon: LucideIcon
  href?: string
  /** When true, href is treated as an absolute URL opened in a new tab (external link). */
  external?: boolean
  onSelect?: () => void | Promise<void>
  variant?: "default" | "destructive"
  separatorBefore?: boolean
}

export interface SidebarActionPreview {
  streamName: string
  authorName?: string
  content: string
  createdAt?: string
}

interface SidebarActionMenuProps {
  actions: SidebarActionItem[]
  trigger?: ReactNode
  ariaLabel?: string
  align?: ComponentProps<typeof DropdownMenuContent>["align"]
  side?: ComponentProps<typeof DropdownMenuContent>["side"]
  contentClassName?: string
}

async function runSidebarAction(action: SidebarActionItem) {
  if (!action.onSelect) return

  try {
    await action.onSelect()
  } catch (error) {
    console.error(`Sidebar action "${action.id}" failed:`, error)
    toast.error(error instanceof Error ? error.message : `Failed to complete ${action.label.toLowerCase()}`)
  }
}

function SidebarActionContent({ action, iconClassName }: { action: SidebarActionItem; iconClassName: string }) {
  const Icon = action.icon

  return (
    <>
      <Icon className={iconClassName} />
      <span>{action.label}</span>
    </>
  )
}

/**
 * Href variant renderer — picks between an external `<a target=_blank>` and an
 * internal react-router `<Link>`. Buttons (non-href actions) use a separate
 * branch because radix `DropdownMenuItem` wants `onSelect`, not a child click.
 */
function SidebarActionHrefElement({
  action,
  className,
  onClick,
  children,
}: {
  action: SidebarActionItem & { href: string }
  className?: string
  onClick: () => void
  children: ReactNode
}) {
  if (action.external) {
    return (
      <a href={action.href} target="_blank" rel="noopener noreferrer" className={className} onClick={onClick}>
        {children}
      </a>
    )
  }
  return (
    <Link to={action.href} className={className} onClick={onClick}>
      {children}
    </Link>
  )
}

function SidebarActionMenuEntry({ action }: { action: SidebarActionItem }) {
  const isDestructive = action.variant === "destructive"
  const itemClassName = cn(isDestructive && "text-destructive focus:text-destructive")
  const content = <SidebarActionContent action={action} iconClassName="mr-2 h-4 w-4" />
  const handleClick = () => {
    void runSidebarAction(action)
  }

  const renderedItem = action.href ? (
    <DropdownMenuItem asChild className={itemClassName}>
      <SidebarActionHrefElement action={{ ...action, href: action.href }} onClick={handleClick}>
        {content}
      </SidebarActionHrefElement>
    </DropdownMenuItem>
  ) : (
    <DropdownMenuItem className={itemClassName} onSelect={handleClick}>
      {content}
    </DropdownMenuItem>
  )

  return (
    <div>
      {action.separatorBefore && <DropdownMenuSeparator />}
      {renderedItem}
    </div>
  )
}

export function SidebarActionMenu({
  actions,
  trigger,
  ariaLabel = "Sidebar actions",
  align = "end",
  side,
  contentClassName,
}: SidebarActionMenuProps) {
  const { setMenuOpen } = useSidebar()

  if (actions.length === 0) return null

  const defaultTrigger = (
    <Button
      variant="ghost"
      size="icon"
      className="absolute right-1 top-1 hidden h-6 w-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 sm:flex"
      aria-label={ariaLabel}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <MoreHorizontal className="h-3.5 w-3.5" />
    </Button>
  )

  return (
    <DropdownMenu onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>{trigger ?? defaultTrigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className={cn("w-40", contentClassName)}>
        {actions.map((action) => (
          <SidebarActionMenuEntry key={action.id} action={action} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface SidebarActionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actions: SidebarActionItem[]
  title?: string
  description?: string
  header?: ReactNode
  preview?: SidebarActionPreview | null
}

export function SidebarActionDrawer({
  open,
  onOpenChange,
  actions,
  title = "Sidebar actions",
  description = "Choose an action.",
  header,
  preview,
}: SidebarActionDrawerProps) {
  const hasVisibleContent = actions.length > 0 || preview != null || header != null

  if (!open && !hasVisibleContent) return null

  const resolvedHeader =
    header ??
    (preview ? (
      <div className="px-4 pt-1 pb-3">
        <div className="rounded-xl bg-muted/60 px-3.5 py-2.5">
          <p className="mb-1 text-sm font-medium text-foreground">{preview.streamName}</p>
          {(preview.authorName || preview.createdAt) && (
            <div className="mb-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
              {preview.authorName && <span className="truncate">{preview.authorName}</span>}
              {preview.authorName && preview.createdAt && <span className="text-muted-foreground/50">·</span>}
              {preview.createdAt && <RelativeTime date={preview.createdAt} className="shrink-0" />}
            </div>
          )}
          <p className="line-clamp-3 text-sm leading-snug text-foreground/80">{preview.content}</p>
        </div>
      </div>
    ) : null)

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerTitle className="sr-only">{title}</DrawerTitle>
        <DrawerDescription className="sr-only">{description}</DrawerDescription>

        {resolvedHeader}

        {actions.length > 0 && (
          <div className="px-2 pb-[max(12px,env(safe-area-inset-bottom))]">
            {actions.map((action) => (
              <SidebarActionDrawerEntry
                key={action.id}
                action={action}
                onClose={() => {
                  onOpenChange(false)
                }}
              />
            ))}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  )
}

function SidebarActionDrawerEntry({ action, onClose }: { action: SidebarActionItem; onClose: () => void }) {
  const isDestructive = action.variant === "destructive"
  const className = cn(
    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
    isDestructive ? "text-destructive active:bg-destructive/10" : "active:bg-muted/80"
  )
  const content = (
    <SidebarActionContent
      action={action}
      iconClassName={cn("h-[18px] w-[18px] shrink-0", isDestructive ? "text-destructive" : "text-muted-foreground")}
    />
  )

  const handleClick = () => {
    onClose()
    void runSidebarAction(action)
  }

  const renderedItem = action.href ? (
    <SidebarActionHrefElement action={{ ...action, href: action.href }} className={className} onClick={handleClick}>
      {content}
    </SidebarActionHrefElement>
  ) : (
    <button type="button" className={className} onClick={handleClick}>
      {content}
    </button>
  )

  return (
    <div>
      {action.separatorBefore && <Divider />}
      {renderedItem}
    </div>
  )
}

function Divider() {
  return <Separator className="mx-3 my-1 bg-border/50" />
}
