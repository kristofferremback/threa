import { ChevronRight, Plus } from "lucide-react"
import type { ReactNode, RefObject } from "react"
import { cn } from "@/lib/utils"
import { SMART_SECTIONS } from "./config"
import { StreamItem } from "./stream-item"
import type { SectionKey, StreamItemData } from "./types"

interface SectionHeaderProps {
  label: string
  icon?: string
  /** Whether the section is currently collapsed */
  isCollapsed?: boolean
  /** Toggle callback - if provided, section becomes collapsible */
  onToggle?: () => void
  /** Add button callback - shows plus icon on hover */
  onAdd?: () => void
  /** Tooltip for add button */
  addTooltip?: string
}

/** Section header with consistent styling across all views */
function SectionHeader({ label, icon, isCollapsed, onToggle, onAdd, addTooltip }: SectionHeaderProps) {
  const isCollapsible = !!onToggle

  const headingContent = (
    <div className="flex items-center gap-1.5">
      {isCollapsible && (
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            !isCollapsed && "rotate-90"
          )}
        />
      )}
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground m-0">
        {icon && `${icon} `}
        {label}
      </h3>
    </div>
  )

  const rightContent = (
    <div className="flex items-center gap-1">
      {onAdd && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onAdd()
          }}
          className="h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover/section:opacity-100 hover:bg-muted transition-all"
          title={addTooltip}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )

  if (isCollapsible) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onToggle()
          }
        }}
        className={cn(
          "group/section w-full flex items-center justify-between px-3 py-2 rounded-md cursor-pointer",
          "hover:bg-muted/50 transition-colors"
        )}
      >
        {headingContent}
        {rightContent}
      </div>
    )
  }

  return (
    <div className="group/section px-3 py-2 flex items-center justify-between">
      {headingContent}
      {rightContent}
    </div>
  )
}

interface StreamSectionProps {
  label: string
  icon?: string
  items: StreamItemData[]
  allStreams: StreamItemData[]
  workspaceId: string
  activeStreamId?: string
  getUnreadCount: (streamId: string) => number
  getMentionCount: (streamId: string) => number
  isCollapsed?: boolean
  onToggle?: () => void
  showCollapsedHint?: boolean
  action?: ReactNode
  /** Show compact view (title only, no preview) */
  compact?: boolean
  /** Show preview on hover when compact (only works with compact=true) */
  showPreviewOnHover?: boolean
  /** Reference to scroll container for position tracking */
  scrollContainerRef?: RefObject<HTMLDivElement | null>
  /** Add button callback - shows plus icon in header */
  onAdd?: () => void
  /** Tooltip for add button */
  addTooltip?: string
}

/** Stream section that composes SectionHeader + items + optional action */
export function StreamSection({
  label,
  icon,
  items,
  allStreams,
  workspaceId,
  activeStreamId,
  getUnreadCount,
  getMentionCount,
  isCollapsed = false,
  onToggle,
  showCollapsedHint = false,
  action,
  compact = false,
  showPreviewOnHover = false,
  scrollContainerRef,
  onAdd,
  addTooltip,
}: StreamSectionProps) {
  return (
    <div className="mb-4">
      <SectionHeader
        label={label}
        icon={icon}
        isCollapsed={isCollapsed}
        onToggle={onToggle}
        onAdd={onAdd}
        addTooltip={addTooltip}
      />

      {/* Section items */}
      {!isCollapsed && (
        <div className="mt-1 flex flex-col gap-0.5">
          {items.map((stream) => (
            <StreamItem
              key={stream.id}
              workspaceId={workspaceId}
              stream={stream}
              isActive={stream.id === activeStreamId}
              unreadCount={getUnreadCount(stream.id)}
              mentionCount={getMentionCount(stream.id)}
              allStreams={allStreams}
              compact={compact}
              showPreviewOnHover={showPreviewOnHover}
              scrollContainerRef={scrollContainerRef}
            />
          ))}
        </div>
      )}

      {/* Collapsed hint for "Everything Else" style sections */}
      {showCollapsedHint && isCollapsed && items.length > 0 && (
        <div className="mx-3 mt-1 px-3 py-2 rounded-md bg-muted/30 border border-dashed border-border/50">
          <p className="text-center text-xs text-muted-foreground">
            {items.length} more stream{items.length !== 1 ? "s" : ""} — click to expand or use{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">⌘K</kbd>
          </p>
        </div>
      )}

      {/* Optional action (like "+ New Scratchpad" button) */}
      {!isCollapsed && action}
    </div>
  )
}

interface SmartSectionProps {
  section: SectionKey
  items: StreamItemData[]
  allStreams: StreamItemData[]
  workspaceId: string
  activeStreamId?: string
  getUnreadCount: (streamId: string) => number
  getMentionCount: (streamId: string) => number
  isCollapsed?: boolean
  onToggle?: () => void
  /** Reference to scroll container for position tracking */
  scrollContainerRef?: RefObject<HTMLDivElement | null>
}

/** Smart view section wrapper - uses StreamSection with config-driven settings */
export function SmartSection({
  section,
  items,
  allStreams,
  workspaceId,
  activeStreamId,
  getUnreadCount,
  getMentionCount,
  isCollapsed = false,
  onToggle,
  scrollContainerRef,
}: SmartSectionProps) {
  const config = SMART_SECTIONS[section]

  // Hide empty sections
  if (items.length === 0) return null

  return (
    <StreamSection
      label={config.label}
      icon={config.icon}
      items={items}
      allStreams={allStreams}
      workspaceId={workspaceId}
      activeStreamId={activeStreamId}
      getUnreadCount={getUnreadCount}
      getMentionCount={getMentionCount}
      isCollapsed={isCollapsed}
      onToggle={onToggle}
      showCollapsedHint={config.showCollapsedHint}
      compact={config.compact}
      showPreviewOnHover={config.showPreviewOnHover}
      scrollContainerRef={scrollContainerRef}
    />
  )
}
