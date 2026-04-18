import type { ReactNode, RefObject } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"

interface SidebarShellProps {
  header: ReactNode
  /** Scrollable body content (quick links + stream list, or skeleton/error fallback). */
  body: ReactNode
  footer?: ReactNode
  /** Ref for measuring sidebar dimensions */
  sidebarRef?: RefObject<HTMLDivElement | null>
  /** Ref for the inner scroll container (used for position tracking by stream items) */
  scrollContainerRef?: RefObject<HTMLDivElement | null>
}

/**
 * Sidebar structural shell.
 * Header is pinned at the top. Everything else (quick links + stream list)
 * lives inside a single scroll area. Footer is pinned at the bottom.
 *
 * Note: Collapsed state is handled by app-shell.tsx which clips the sidebar to 6px.
 * This component just renders content — no need to react to collapse state.
 */
export function SidebarShell({ header, body, footer, sidebarRef, scrollContainerRef }: SidebarShellProps) {
  return (
    <div ref={sidebarRef} className="relative flex h-full flex-col">
      <div className="flex-shrink-0">{header}</div>

      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full [&>div>div]:!block [&>div>div]:!w-full">
          <div ref={scrollContainerRef} className="p-2">
            {body}
          </div>
        </ScrollArea>
      </div>

      {footer && <div className="flex-shrink-0 border-t px-2 py-2">{footer}</div>}
    </div>
  )
}
