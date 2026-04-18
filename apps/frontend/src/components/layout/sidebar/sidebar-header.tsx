import { Search as SearchIcon, Terminal, FileText } from "lucide-react"
import { Link } from "react-router-dom"
import { useQuickSwitcher, type ViewMode } from "@/contexts"
import { useSidebar } from "@/contexts"
import { cn } from "@/lib/utils"
import { ThemeDropdown } from "@/components/theme-dropdown"
import { ThreaLogo } from "@/components/threa-logo"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SidebarToggle } from "@/components/layout/sidebar-toggle"

/** Platform-appropriate modifier key symbol (⌘ on Mac, Ctrl on Windows/Linux) */
const MOD_KEY = typeof navigator !== "undefined" && navigator.platform?.toLowerCase().includes("mac") ? "⌘" : "Ctrl+"

interface SidebarHeaderProps {
  workspaceName: string
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  /** Hide the view toggle (e.g., when no streams exist) */
  hideViewToggle?: boolean
}

export function SidebarHeader({ workspaceName, viewMode, onViewModeChange, hideViewToggle }: SidebarHeaderProps) {
  const { openSwitcher } = useQuickSwitcher()
  const { collapseOnMobile } = useSidebar()

  const handleOpenSwitcher = (mode: "stream" | "command" | "search") => () => {
    collapseOnMobile()
    openSwitcher(mode)
  }

  return (
    <div className="flex-shrink-0 border-b">
      {/* Top row — mirrors the h-11 page-header row so the sidebar toggle sits
           in the identical viewport position whether the sidebar is open or not. */}
      <div className="flex h-11 items-center gap-1 px-4">
        <SidebarToggle location="sidebar" />
        <Link
          to="/workspaces"
          className="flex min-w-0 items-center gap-2 truncate transition-opacity hover:opacity-80"
          onClick={collapseOnMobile}
        >
          <ThreaLogo size="sm" />
          <span className="truncate text-sm font-semibold">{workspaceName}</span>
        </Link>
        <div className="ml-auto flex items-center">
          <ThemeDropdown />
        </div>
      </div>

      {/* Quick-action pills — replaces the former full-width search box. The
           three affordances (stream / command palette / message search) are the
           entry points to the three quick-switcher modes. */}
      <div className="flex items-center gap-1 px-3 pt-2">
        <QuickActionPill
          onClick={handleOpenSwitcher("stream")}
          icon={FileText}
          label="Jump to stream"
          shortcut={`${MOD_KEY}K`}
        />
        <QuickActionPill
          onClick={handleOpenSwitcher("command")}
          icon={Terminal}
          label="Commands"
          shortcut={`${MOD_KEY}Shift+P`}
        />
        <QuickActionPill
          onClick={handleOpenSwitcher("search")}
          icon={SearchIcon}
          label="Search messages"
          shortcut={`${MOD_KEY}/`}
        />
      </div>

      {/* View toggle - hidden when no streams */}
      {!hideViewToggle && (
        <div className="flex items-center gap-2 px-3 pb-3 pt-2">
          <div className="flex gap-1 rounded-md bg-muted p-0.5">
            <button
              onClick={() => onViewModeChange("smart")}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium transition-all",
                viewMode === "smart" ? "bg-card text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Smart
            </button>
            <button
              onClick={() => onViewModeChange("all")}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium transition-all",
                viewMode === "all" ? "bg-card text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              All
            </button>
          </div>
        </div>
      )}

      {/* When the view toggle is hidden we still need trailing breathing room
           under the pill row so the list below doesn't butt against the border. */}
      {hideViewToggle && <div className="h-3" aria-hidden="true" />}
    </div>
  )
}

interface QuickActionPillProps {
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
  shortcut: string
}

function QuickActionPill({ onClick, icon: Icon, label, shortcut }: QuickActionPillProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={cn(
            "flex h-8 flex-1 items-center justify-center rounded-md border border-border bg-background",
            "text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-2">
        <span>{label}</span>
        <kbd className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">{shortcut}</kbd>
      </TooltipContent>
    </Tooltip>
  )
}
