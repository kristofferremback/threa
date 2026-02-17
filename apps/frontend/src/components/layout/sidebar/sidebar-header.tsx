import { Search as SearchIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useQuickSwitcher, type ViewMode } from "@/contexts"
import { cn } from "@/lib/utils"
import { ThemeDropdown } from "@/components/theme-dropdown"
import { ThreaLogo } from "@/components/threa-logo"

interface SidebarHeaderProps {
  workspaceName: string
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  /** Hide the view toggle (e.g., when no streams exist) */
  hideViewToggle?: boolean
}

export function SidebarHeader({ workspaceName, viewMode, onViewModeChange, hideViewToggle }: SidebarHeaderProps) {
  const { openSwitcher } = useQuickSwitcher()

  return (
    <div className="flex-shrink-0 border-b px-4 py-3">
      {/* Logo + workspace name + actions */}
      <div className="flex items-center justify-between mb-3">
        <Link to="/workspaces" className="flex items-center gap-2 hover:opacity-80 transition-opacity truncate">
          <ThreaLogo size="sm" />
          <span className="font-semibold text-sm truncate">{workspaceName}</span>
        </Link>
        <ThemeDropdown />
      </div>

      {/* Search box */}
      <button
        onClick={() => openSwitcher("search")}
        className="w-full flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        <SearchIcon className="h-3.5 w-3.5" />
        <span>Search messages</span>
      </button>

      {/* View toggle - hidden when no streams */}
      {!hideViewToggle && (
        <div className="flex items-center gap-2 mt-3">
          <div className="flex gap-1 bg-muted rounded-md p-0.5">
            <button
              onClick={() => onViewModeChange("smart")}
              className={cn(
                "px-2 py-1 rounded text-xs font-medium transition-all",
                viewMode === "smart" ? "bg-card text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Smart
            </button>
            <button
              onClick={() => onViewModeChange("all")}
              className={cn(
                "px-2 py-1 rounded text-xs font-medium transition-all",
                viewMode === "all" ? "bg-card text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              All
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
