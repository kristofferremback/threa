import { ChevronUp, DollarSign, LogOut, Settings, User } from "lucide-react"
import { Link, useSearchParams } from "react-router-dom"
import { useAuth } from "@/auth"
import { useSettings } from "@/contexts"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getInitials } from "@/lib/initials"
import { cn } from "@/lib/utils"
import { getAvatarUrl, type WorkspaceMember } from "@threa/types"

interface SidebarFooterProps {
  workspaceId: string
  currentMember: WorkspaceMember | null
}

export function SidebarFooter({ workspaceId, currentMember }: SidebarFooterProps) {
  const [, setSearchParams] = useSearchParams()
  const { openSettings } = useSettings()
  const { logout } = useAuth()

  const openWorkspaceSettings = () => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set("ws-settings", "members")
        return next
      },
      { replace: true }
    )
  }

  if (!currentMember) return null

  const avatarSrc = getAvatarUrl(currentMember.avatarUrl, 64)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            "hover:bg-muted/50"
          )}
        >
          <Avatar className="h-7 w-7">
            {avatarSrc && <AvatarImage src={avatarSrc} alt={currentMember.name} />}
            <AvatarFallback className="text-[10px]">{getInitials(currentMember.name)}</AvatarFallback>
          </Avatar>
          <span className="truncate flex-1 text-left">{currentMember.name}</span>
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuItem onClick={() => openSettings("profile")}>
          <User className="mr-2 h-4 w-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openSettings("appearance")}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={openWorkspaceSettings}>
          <Settings className="mr-2 h-4 w-4" />
          Workspace Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={`/w/${workspaceId}/admin/ai-usage`}>
            <DollarSign className="mr-2 h-4 w-4" />
            AI Usage
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => logout()}>
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
