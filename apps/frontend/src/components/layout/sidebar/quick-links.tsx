import { Bell, FileEdit, MessageSquareText } from "lucide-react"
import { Link } from "react-router-dom"
import { UnreadBadge } from "@/components/unread-badge"
import { cn } from "@/lib/utils"

interface SidebarQuickLinksProps {
  workspaceId: string
  isDraftsPage: boolean
  draftCount: number
  isActivityPage: boolean
  unreadActivityCount: number
}

export function SidebarQuickLinks({
  workspaceId,
  isDraftsPage,
  draftCount,
  isActivityPage,
  unreadActivityCount,
}: SidebarQuickLinksProps) {
  return (
    <div className="space-y-1">
      <Link
        to={`/w/${workspaceId}/drafts`}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
          isDraftsPage ? "bg-primary/10" : "hover:bg-muted/50",
          !isDraftsPage && draftCount === 0 && "text-muted-foreground"
        )}
      >
        <FileEdit className="h-4 w-4" />
        Drafts
        {draftCount > 0 && <span className="ml-auto text-xs text-muted-foreground">({draftCount})</span>}
      </Link>
      <Link
        to={`/w/${workspaceId}/threads`}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
          "hover:bg-muted/50 text-muted-foreground"
        )}
      >
        <MessageSquareText className="h-4 w-4" />
        Threads
      </Link>
      <Link
        to={`/w/${workspaceId}/activity`}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
          isActivityPage ? "bg-primary/10" : "hover:bg-muted/50",
          !isActivityPage && unreadActivityCount === 0 && "text-muted-foreground"
        )}
      >
        <Bell className="h-4 w-4" />
        Activity
        {unreadActivityCount > 0 && <UnreadBadge count={unreadActivityCount} className="ml-auto" />}
      </Link>
    </div>
  )
}
