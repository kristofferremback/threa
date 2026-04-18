import { PanelLeft, PanelLeftClose } from "lucide-react"
import { useSidebar } from "@/contexts"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface SidebarToggleProps {
  /**
   * Where this toggle is rendered:
   * - "sidebar": inside the sidebar header; visible only when the sidebar is open
   * - "page": inside a page/stream header; visible only when the sidebar is closed
   *
   * Both locations anchor the button to the same viewport x-coordinate (~16px)
   * so users can toggle without moving the cursor.
   */
  location: "sidebar" | "page"
  className?: string
}

export function SidebarToggle({ location, className }: SidebarToggleProps) {
  const { state, isMobile, togglePinned } = useSidebar()
  const isOpen = state === "pinned" || state === "preview"
  // Icon reflects whether clicking will collapse (currently open) or expand.
  const willCollapse = isMobile ? isOpen : state === "pinned"

  const visible = location === "sidebar" ? isOpen : !isOpen

  // Desktop page headers sit 6px right of the viewport edge (urgency strip
  // occupies the first 6px). Pull the button 6px left so it lands at the same
  // viewport x as the sidebar version. Not needed on mobile (no strip) or in
  // the sidebar (padding is already measured from the sidebar's own edge).
  const offsetClass = location === "page" && !isMobile ? "-ml-1.5" : ""

  return (
    <div
      className={cn(
        "flex items-center transition-opacity duration-150",
        offsetClass,
        visible ? "opacity-100" : "pointer-events-none opacity-0",
        className
      )}
      aria-hidden={!visible}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={togglePinned}
            tabIndex={visible ? 0 : -1}
            aria-label={willCollapse ? "Collapse sidebar" : "Pin sidebar"}
          >
            {willCollapse ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{willCollapse ? "Collapse sidebar" : "Pin sidebar"}</TooltipContent>
      </Tooltip>
    </div>
  )
}
