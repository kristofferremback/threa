import { type ReactNode, useCallback } from "react"
import { PanelLeftClose, PanelLeft, Command } from "lucide-react"
import { useSidebar, useQuickSwitcher } from "@/contexts"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/** Platform-appropriate modifier key symbol (⌘ on Mac, Ctrl on Windows/Linux) */
const MOD_KEY = navigator.platform?.toLowerCase().includes("mac") ? "⌘" : "Ctrl"

interface TopbarProps {
  isPinned: boolean
  onToggleSidebar: () => void
}

function Topbar({ isPinned, onToggleSidebar }: TopbarProps) {
  const { openSwitcher } = useQuickSwitcher()

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-11 items-center border-b bg-background/80 backdrop-blur-sm">
        {/* Left section - sidebar toggle */}
        <div className="flex w-[100px] items-center px-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onToggleSidebar}
                aria-label={isPinned ? "Collapse sidebar" : "Pin sidebar"}
              >
                {isPinned ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{isPinned ? "Collapse sidebar" : "Pin sidebar"}</TooltipContent>
          </Tooltip>
        </div>

        {/* Center section - placeholder for label tabs (future) */}
        <div className="flex flex-1 items-center justify-center">
          {/* Label tabs will go here when groups are implemented */}
        </div>

        {/* Right section - quick actions */}
        <div className="flex w-[100px] items-center justify-end px-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-xs text-muted-foreground"
                onClick={() => openSwitcher("stream")}
              >
                <Command className="h-3 w-3" />
                <span>K</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Quick switcher ({MOD_KEY}K)</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}

interface AppShellProps {
  sidebar: ReactNode
  children: ReactNode
}

/**
 * Main application shell with collapsible sidebar.
 *
 * Sidebar states:
 * - collapsed: 6px color strip only, 30px hover margin for "magnetic" feel
 * - preview: 260px, positioned absolute, doesn't push content (hover state)
 * - pinned: 260px, positioned normal, pushes content
 */
export function AppShell({ sidebar, children }: AppShellProps) {
  const { state, setHovering, pin, togglePinned } = useSidebar()

  const isCollapsed = state === "collapsed"
  const isPreview = state === "preview"
  const isPinned = state === "pinned"

  // Handle mouse enter on hover margin or sidebar
  const handleMouseEnter = useCallback(() => {
    setHovering(true)
  }, [setHovering])

  // Handle mouse leave from sidebar
  const handleMouseLeave = useCallback(() => {
    setHovering(false)
  }, [setHovering])

  // Click on sidebar pins it (from preview or collapsed)
  const handleSidebarClick = useCallback(() => {
    if (!isPinned) {
      pin()
    }
  }, [isPinned, pin])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {/* Topbar - spans full width */}
      <Topbar isPinned={isPinned} onToggleSidebar={togglePinned} />

      {/* Main area with sidebar and content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar wrapper - handles positioning */}
        <div
          className={cn(
            "relative z-40 flex flex-shrink-0 flex-col",
            // Width transitions
            isCollapsed && "w-1.5",
            isPreview && "w-1.5", // Wrapper stays narrow, sidebar is absolute
            isPinned && "w-64",
            "transition-[width] duration-200 ease-out"
          )}
        >
          {/* Hover margin - 30px invisible zone for "magnetic" feel (only in collapsed state) */}
          {isCollapsed && (
            <div
              className="absolute left-full top-0 z-30 h-full w-[30px]"
              onMouseEnter={handleMouseEnter}
              aria-hidden="true"
            />
          )}

          {/* Sidebar container */}
          <aside
            className={cn(
              "flex h-full flex-col border-r bg-background overflow-hidden",
              // Width
              isCollapsed && "w-1.5",
              (isPreview || isPinned) && "w-64",
              // Positioning - preview is absolute but within this container
              isPreview && "absolute left-0 top-0 shadow-[4px_0_24px_hsl(var(--foreground)/0.08)]",
              // Transitions
              "transition-[width,box-shadow] duration-200 ease-out"
            )}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleSidebarClick}
            role="navigation"
            aria-label="Sidebar navigation"
          >
            {sidebar}
          </aside>
        </div>

        {/* Main content area */}
        <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  )
}
