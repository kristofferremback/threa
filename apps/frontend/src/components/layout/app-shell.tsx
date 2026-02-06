import { type ReactNode, useCallback, useEffect, useRef } from "react"
import { PanelLeftClose, PanelLeft, Command } from "lucide-react"
import { useSidebar, useQuickSwitcher, useCoordinatedLoading } from "@/contexts"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TopbarLoadingIndicator } from "./topbar-loading-indicator"
import { cn } from "@/lib/utils"

/** Platform-appropriate modifier key symbol (⌘ on Mac, Ctrl on Windows/Linux) */
const MOD_KEY = navigator.platform?.toLowerCase().includes("mac") ? "⌘" : "Ctrl"

interface TopbarProps {
  isPinned: boolean
  onToggleSidebar: () => void
}

function Topbar({ isPinned, onToggleSidebar }: TopbarProps) {
  const { openSwitcher } = useQuickSwitcher()
  const { showLoadingIndicator } = useCoordinatedLoading()

  return (
    <div className="relative flex h-11 items-center border-b bg-background/80 backdrop-blur-sm">
      {/* Loading indicator - subtle shimmer at bottom border */}
      <TopbarLoadingIndicator visible={showLoadingIndicator} />
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
 * - preview: user-defined width, positioned absolute, doesn't push content (hover state)
 * - pinned: user-defined width, positioned normal, pushes content
 */
export function AppShell({ sidebar, children }: AppShellProps) {
  const {
    state,
    width,
    isMobile,
    isResizing,
    urgencyBlocks,
    setHovering,
    collapse,
    togglePinned,
    startResizing,
    stopResizing,
    setWidth,
  } = useSidebar()
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const isCollapsed = state === "collapsed"
  const isPreview = state === "preview"
  const isPinned = state === "pinned"
  const isOpen = isPreview || isPinned

  // Handle mouse enter on hover margin or sidebar (disabled on mobile - touch devices don't hover)
  const handleMouseEnter = useCallback(() => {
    if (!isMobile) {
      setHovering(true)
    }
  }, [setHovering, isMobile])

  // Handle mouse leave from sidebar
  const handleMouseLeave = useCallback(() => {
    if (!isMobile) {
      setHovering(false)
    }
  }, [setHovering, isMobile])

  // Close backdrop on mobile
  const handleBackdropClick = useCallback(() => {
    collapse()
  }, [collapse])

  // Resize handlers
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      resizeRef.current = { startX: e.clientX, startWidth: width }
      startResizing()
    },
    [width, startResizing]
  )

  // Global mouse move/up handlers for resizing
  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return
      const delta = e.clientX - resizeRef.current.startX
      setWidth(resizeRef.current.startWidth + delta)
    }

    const handleMouseUp = () => {
      resizeRef.current = null
      stopResizing()
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isResizing, setWidth, stopResizing])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {/* Topbar - spans full width */}
      <Topbar isPinned={isPinned} onToggleSidebar={togglePinned} />

      {/* Main area with sidebar and content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile backdrop - shown when sidebar is open on mobile */}
        {isMobile && isOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 transition-opacity duration-200"
            onClick={handleBackdropClick}
            aria-hidden="true"
          />
        )}

        {/* Sidebar wrapper - handles positioning */}
        <div
          className={cn(
            "relative z-40 flex flex-shrink-0 flex-col",
            // Transitions - disable during resize for smooth dragging
            !isResizing && "transition-[width] duration-200 ease-out",
            // On mobile, sidebar is always overlay (no wrapper width)
            isMobile && "w-0"
          )}
          style={{
            // Wrapper width: collapsed = 6px, preview = 6px (sidebar absolute), pinned = sidebar width
            // On mobile: always 0 (overlay mode)
            width: isMobile ? "0px" : isCollapsed ? "6px" : isPreview ? "6px" : `${width}px`,
          }}
        >
          {/* Urgency strip - always visible on left edge (6px wide) */}
          {!isMobile && (
            <div
              className="absolute left-0 top-0 h-full w-[6px] z-50 pointer-events-none"
              style={{
                // Clip right edge to prevent blur bleeding into sidebar/content
                // Let blur extend left (off-screen), up, and down for soft glow
                clipPath: "inset(-50px 0 -50px -50px)",
              }}
              aria-hidden="true"
            >
              {/* Grey baseline - always visible */}
              <div className="absolute inset-0" style={{ backgroundColor: "hsl(var(--muted-foreground) / 0.3)" }} />
              {/* Activity blocks - single blurred bar per stream, 150% height centered */}
              {Array.from(urgencyBlocks.entries()).map(([streamId, block]) => {
                const expandedHeight = block.height * 1.5
                const centeredTop = block.position - block.height * 0.25
                return (
                  <div
                    key={streamId}
                    className="absolute transition-opacity duration-300"
                    style={{
                      left: "-4px",
                      width: "14px",
                      top: `${centeredTop * 100}%`,
                      height: `${Math.max(expandedHeight * 100, 4)}%`,
                      backgroundColor: block.color,
                      filter: "blur(12px)",
                      opacity: block.opacity,
                    }}
                  />
                )
              })}
            </div>
          )}

          {/* Hover margin - invisible zone for "magnetic" feel (collapsed state only, not on mobile) */}
          {/* 30px zone to trigger preview when collapsed */}
          {isCollapsed && !isMobile && (
            <div
              className="absolute left-full top-0 z-30 h-full w-[30px]"
              onMouseEnter={handleMouseEnter}
              aria-hidden="true"
            />
          )}

          {/* Coyote Time zone - extends beyond sidebar in preview mode for comfortable resizing */}
          {/* Positioned outside aside (which has overflow-hidden) at sidebar's right edge */}
          {isPreview && !isMobile && (
            <div
              className="absolute top-0 z-50 h-full w-[30px]"
              style={{ left: `${width}px` }}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              aria-hidden="true"
            />
          )}

          {/* Sidebar container - clips content for reveal effect */}
          <aside
            className={cn(
              "relative flex h-full flex-col border-r bg-background overflow-hidden z-40",
              // Positioning - preview is absolute, or always absolute on mobile
              (isPreview || isMobile) && "absolute left-0 top-0 shadow-[4px_0_24px_hsl(var(--foreground)/0.08)]",
              // Transitions - disable during resize for smooth dragging
              !isResizing && "transition-[width,box-shadow] duration-200 ease-out"
            )}
            style={{
              // On mobile: use 85% of screen width when open, 0 when collapsed
              width: isMobile ? (isOpen ? "85vw" : "0px") : isCollapsed ? "6px" : `${width}px`,
              maxWidth: isMobile ? "320px" : undefined,
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            role="navigation"
            aria-label="Sidebar navigation"
          >
            {/* Inner container maintains full width for reveal animation (prevents text reflow) */}
            <div
              className="h-full flex-1 flex flex-col overflow-hidden"
              style={{
                width: isMobile ? "85vw" : `${width}px`,
                minWidth: isMobile ? undefined : `${width}px`,
                maxWidth: isMobile ? "320px" : undefined,
              }}
            >
              {sidebar}
            </div>

            {/* Resize handle - only visible when not collapsed and not on mobile */}
            {!isCollapsed && !isMobile && (
              <div
                className={cn(
                  "absolute right-0 top-0 h-full w-1 cursor-col-resize",
                  "hover:bg-primary/20 active:bg-primary/30",
                  "transition-colors duration-150",
                  "focus-visible:bg-primary/30 focus-visible:outline-none",
                  isResizing && "bg-primary/30"
                )}
                onMouseDown={handleResizeStart}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 50 : 10
                  if (e.key === "ArrowLeft") {
                    e.preventDefault()
                    setWidth(width - step)
                  } else if (e.key === "ArrowRight") {
                    e.preventDefault()
                    setWidth(width + step)
                  }
                }}
                tabIndex={0}
                role="separator"
                aria-orientation="vertical"
                aria-valuenow={width}
                aria-valuemin={200}
                aria-valuemax={400}
                aria-label="Resize sidebar"
              />
            )}
          </aside>
        </div>

        {/* Main content area */}
        <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  )
}
