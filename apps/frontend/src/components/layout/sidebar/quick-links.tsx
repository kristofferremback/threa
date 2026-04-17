import { Bell, Bookmark, Brain, FileEdit, MessageSquareText } from "lucide-react"
import type { ComponentType, ReactNode } from "react"
import { Link } from "react-router-dom"
import { UnreadBadge } from "@/components/unread-badge"
import { useSidebar } from "@/contexts"
import { cn } from "@/lib/utils"
import { SectionHeader } from "./sections"

interface SidebarQuickLinksProps {
  workspaceId: string
  isDraftsPage: boolean
  draftCount: number
  isSavedPage: boolean
  savedCount: number
  isActivityPage: boolean
  isMemoryPage: boolean
  unreadActivityCount: number
}

interface QuickLinkItem {
  key: string
  to: string
  icon: ComponentType<{ className?: string }>
  label: string
  isActive: boolean
  hasSignal: boolean
  signalSlot: ReactNode
}

const SECTION_KEY = "quick-links"
const DEFAULT_STATE = "auto"

export function SidebarQuickLinks({
  workspaceId,
  isDraftsPage,
  draftCount,
  isSavedPage,
  savedCount,
  isActivityPage,
  isMemoryPage,
  unreadActivityCount,
}: SidebarQuickLinksProps) {
  const { collapseOnMobile, getSectionState, cycleSectionState } = useSidebar()
  const state = getSectionState(SECTION_KEY, DEFAULT_STATE)

  const items: QuickLinkItem[] = [
    {
      key: "drafts",
      to: `/w/${workspaceId}/drafts`,
      icon: FileEdit,
      label: "Drafts",
      isActive: isDraftsPage,
      hasSignal: draftCount > 0,
      signalSlot: draftCount > 0 ? <span className="ml-auto text-xs text-muted-foreground">({draftCount})</span> : null,
    },
    {
      key: "saved",
      to: `/w/${workspaceId}/saved`,
      icon: Bookmark,
      label: "Saved",
      isActive: isSavedPage,
      hasSignal: savedCount > 0,
      signalSlot: savedCount > 0 ? <span className="ml-auto text-xs text-muted-foreground">({savedCount})</span> : null,
    },
    {
      key: "threads",
      to: `/w/${workspaceId}/threads`,
      icon: MessageSquareText,
      label: "Threads",
      isActive: false,
      hasSignal: false,
      signalSlot: null,
    },
    {
      key: "memory",
      to: `/w/${workspaceId}/memory`,
      icon: Brain,
      label: "Memory",
      isActive: isMemoryPage,
      hasSignal: false,
      signalSlot: null,
    },
    {
      key: "activity",
      to: `/w/${workspaceId}/activity`,
      icon: Bell,
      label: "Activity",
      isActive: isActivityPage,
      hasSignal: unreadActivityCount > 0,
      signalSlot: unreadActivityCount > 0 ? <UnreadBadge count={unreadActivityCount} className="ml-auto" /> : null,
    },
  ]

  const anySignal = items.some((item) => item.hasSignal)
  const visibleByState: Record<typeof state, QuickLinkItem[]> = {
    open: items,
    auto: items.filter((item) => item.hasSignal),
    collapsed: [],
  }
  const visibleItems = visibleByState[state]

  return (
    <div className="space-y-1">
      <SectionHeader
        label="Quick Links"
        state={state}
        onCycle={() => cycleSectionState(SECTION_KEY, DEFAULT_STATE)}
        anySignal={anySignal}
      />

      {visibleItems.map(({ key, to, icon: Icon, label, isActive, hasSignal, signalSlot }) => (
        <Link
          key={key}
          to={to}
          onClick={collapseOnMobile}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            isActive ? "bg-primary/10" : "hover:bg-muted/50",
            !isActive && !hasSignal && "text-muted-foreground"
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
          {signalSlot}
        </Link>
      ))}
    </div>
  )
}
