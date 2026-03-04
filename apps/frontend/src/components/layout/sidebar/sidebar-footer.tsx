import { useCallback, useMemo, useState } from "react"
import { ChevronUp, DollarSign, LogOut, Settings, User as UserIcon } from "lucide-react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "@/auth"
import { useSettings, useSidebar } from "@/contexts"
import { useIsMobile } from "@/hooks/use-mobile"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getInitials } from "@/lib/initials"
import { cn } from "@/lib/utils"
import { getAvatarUrl, type User } from "@threa/types"
import { SidebarActionDrawer, SidebarActionMenu, type SidebarActionItem } from "./sidebar-actions"

interface SidebarFooterProps {
  workspaceId: string
  currentUser: User | null
}

interface SidebarFooterTriggerProps {
  avatarSrc?: string | null
  currentUser: User
  onClick?: () => void
}

function SidebarFooterTrigger({ avatarSrc, currentUser, onClick }: SidebarFooterTriggerProps) {
  return (
    <button
      type="button"
      className={cn(
        "w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        "hover:bg-muted/50"
      )}
      onClick={onClick}
    >
      <Avatar className="h-7 w-7">
        {avatarSrc && <AvatarImage src={avatarSrc} alt={currentUser.name} />}
        <AvatarFallback className="text-[10px]">{getInitials(currentUser.name)}</AvatarFallback>
      </Avatar>
      <span className="truncate flex-1 text-left">{currentUser.name}</span>
      <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  )
}

function SidebarFooterHeader({ avatarSrc, currentUser }: { avatarSrc?: string | null; currentUser: User }) {
  return (
    <div className="px-4 pt-1 pb-3">
      <div className="rounded-xl bg-muted/60 px-3.5 py-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            {avatarSrc && <AvatarImage src={avatarSrc} alt={currentUser.name} />}
            <AvatarFallback>{getInitials(currentUser.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{currentUser.name}</p>
            <p className="truncate text-xs text-muted-foreground">{currentUser.email}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SidebarFooter({ workspaceId, currentUser }: SidebarFooterProps) {
  const [, setSearchParams] = useSearchParams()
  const { openSettings } = useSettings()
  const { logout } = useAuth()
  const { collapseOnMobile } = useSidebar()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleOpenSettings = useCallback(
    (tab: "profile" | "appearance") => {
      collapseOnMobile()
      openSettings(tab)
    },
    [collapseOnMobile, openSettings]
  )

  const openWorkspaceSettings = useCallback(() => {
    collapseOnMobile()
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set("ws-settings", "users")
        return next
      },
      { replace: true }
    )
  }, [collapseOnMobile, setSearchParams])

  if (!currentUser) return null

  const avatarSrc = getAvatarUrl(workspaceId, currentUser.avatarUrl, 64)
  const menuActions = useMemo<SidebarActionItem[]>(
    () => [
      {
        id: "profile",
        label: "Profile",
        icon: UserIcon,
        onSelect: () => handleOpenSettings("profile"),
      },
      {
        id: "settings",
        label: "Settings",
        icon: Settings,
        onSelect: () => handleOpenSettings("appearance"),
      },
      {
        id: "workspace-settings",
        label: "Workspace Settings",
        icon: Settings,
        onSelect: openWorkspaceSettings,
      },
      {
        id: "ai-usage",
        label: "AI Usage",
        icon: DollarSign,
        href: `/w/${workspaceId}/admin/ai-usage`,
        onSelect: collapseOnMobile,
        separatorBefore: true,
      },
      {
        id: "logout",
        label: "Log out",
        icon: LogOut,
        onSelect: () => logout(),
        separatorBefore: true,
      },
    ],
    [handleOpenSettings, openWorkspaceSettings, collapseOnMobile, logout, workspaceId]
  )

  if (isMobile) {
    return (
      <>
        <SidebarFooterTrigger avatarSrc={avatarSrc} currentUser={currentUser} onClick={() => setDrawerOpen(true)} />
        <SidebarActionDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          actions={menuActions}
          title="Account menu"
          description="Choose an account action."
          header={<SidebarFooterHeader avatarSrc={avatarSrc} currentUser={currentUser} />}
        />
      </>
    )
  }

  return (
    <SidebarActionMenu
      actions={menuActions}
      ariaLabel="Account menu"
      side="top"
      align="start"
      contentClassName="w-56"
      trigger={<SidebarFooterTrigger avatarSrc={avatarSrc} currentUser={currentUser} />}
    />
  )
}
