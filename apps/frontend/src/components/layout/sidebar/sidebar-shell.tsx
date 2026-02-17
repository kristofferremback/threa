import type { ReactNode, RefObject } from "react"

interface SidebarShellProps {
  header: ReactNode
  quickLinks: ReactNode
  streamList: ReactNode
  footer?: ReactNode
  /** Ref for measuring sidebar dimensions */
  sidebarRef?: RefObject<HTMLDivElement | null>
}

/**
 * Sidebar structural shell.
 * Note: Collapsed state is handled by app-shell.tsx which clips the sidebar to 6px.
 * This component just renders content - no need to react to collapse state.
 */
export function SidebarShell({ header, quickLinks, streamList, footer, sidebarRef }: SidebarShellProps) {
  return (
    <div ref={sidebarRef} className="relative flex h-full flex-col">
      {/* Header */}
      <div>{header}</div>

      {/* Quick links (Drafts, Threads) */}
      <div className="border-b px-2 py-2">{quickLinks}</div>

      {/* Body with scrollable content */}
      <div className="flex-1 overflow-hidden">{streamList}</div>

      {/* Footer */}
      {footer && <div className="border-t px-2 py-2">{footer}</div>}
    </div>
  )
}
