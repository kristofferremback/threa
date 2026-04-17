import { Plus } from "lucide-react"
import type { ReactNode, RefObject } from "react"
import type { CollapseState } from "@/contexts"
import { cn } from "@/lib/utils"
import { SMART_SECTIONS } from "./config"
import { StreamItem } from "./stream-item"
import type { SectionKey, StreamItemData } from "./types"

interface SectionHeaderProps {
  label: string
  icon?: string
  /** Current collapse state. If omitted, header renders as static (non-clickable). */
  state?: CollapseState
  /** Cycle callback. If omitted, header renders as static. */
  onCycle?: () => void
  /**
   * Whether any item in this section is signaling (unread/mention/count).
   * Used to show a dot on the header in `collapsed` state.
   */
  anySignal?: boolean
  /** Add button callback - shows plus icon on hover */
  onAdd?: () => void
  /** Tooltip for add button */
  addTooltip?: string
}

const STATE_TO_FILLED: Record<CollapseState, number> = {
  open: 3,
  auto: 2,
  collapsed: 1,
}

const STATE_TITLE: Record<CollapseState, string> = {
  open: "Hide quiet items",
  auto: "Collapse section",
  collapsed: "Expand section",
}

/** Section header with stepper-dot state indicator. Consistent across all sidebar sections. */
export function SectionHeader({
  label,
  icon,
  state,
  onCycle,
  anySignal = false,
  onAdd,
  addTooltip,
}: SectionHeaderProps) {
  const isInteractive = !!onCycle && !!state
  const filled = state ? STATE_TO_FILLED[state] : 0
  const headerTitle = state ? STATE_TITLE[state] : undefined

  const headingContent = (
    <div className="flex items-center gap-2">
      {isInteractive && (
        <div className="flex items-center gap-0.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-colors duration-150",
                i < filled ? "bg-muted-foreground" : "bg-muted-foreground/20"
              )}
            />
          ))}
        </div>
      )}
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground m-0">
        {icon && `${icon} `}
        {label}
      </h3>
    </div>
  )

  const rightContent = (
    <div className="flex items-center gap-1">
      {state === "collapsed" && anySignal && (
        <span aria-label="Unread activity" className="h-2 w-2 rounded-full bg-primary" />
      )}
      {onAdd && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onAdd()
          }}
          className="h-5 w-5 max-sm:h-8 max-sm:w-8 flex items-center justify-center rounded opacity-0 group-hover/section:opacity-100 max-sm:opacity-100 hover:bg-muted transition-all"
          title={addTooltip}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )

  if (isInteractive) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={headerTitle}
        aria-expanded={state !== "collapsed"}
        title={headerTitle}
        onClick={onCycle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onCycle()
          }
        }}
        className={cn(
          "group/section w-full flex items-center justify-between px-3 py-2 rounded-md cursor-pointer select-none [-webkit-touch-callout:none]",
          "hover:bg-muted/50 transition-colors"
        )}
      >
        {headingContent}
        {rightContent}
      </div>
    )
  }

  return (
    <div className="group/section px-3 py-2 flex items-center justify-between select-none [-webkit-touch-callout:none]">
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
  state?: CollapseState
  onCycle?: () => void
  /** Called when the "N more streams" hint button is clicked. Defaults to onCycle if unset. */
  onExpand?: () => void
  showCollapsedHint?: boolean
  /** When true, `auto` mode behaves like `open` (useful for sections like Pinned where filtering by signal defeats the point). */
  alwaysShowAll?: boolean
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

function hasStreamSignal(
  stream: StreamItemData,
  getUnreadCount: (streamId: string) => number,
  getMentionCount: (streamId: string) => number
) {
  return getUnreadCount(stream.id) > 0 || getMentionCount(stream.id) > 0
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
  state = "open",
  onCycle,
  onExpand,
  showCollapsedHint = false,
  alwaysShowAll = false,
  action,
  compact = false,
  showPreviewOnHover = false,
  scrollContainerRef,
  onAdd,
  addTooltip,
}: StreamSectionProps) {
  const anySignal = items.some((stream) => hasStreamSignal(stream, getUnreadCount, getMentionCount))
  const filterByAuto = state === "auto" && !alwaysShowAll

  let visibleItems: StreamItemData[]
  if (state === "collapsed") {
    visibleItems = []
  } else if (filterByAuto) {
    visibleItems = items.filter((stream) => hasStreamSignal(stream, getUnreadCount, getMentionCount))
  } else {
    visibleItems = items
  }

  const isCollapsed = state === "collapsed"

  return (
    <div className="mb-4">
      <SectionHeader
        label={label}
        icon={icon}
        state={state}
        onCycle={onCycle}
        anySignal={anySignal}
        onAdd={onAdd}
        addTooltip={addTooltip}
      />

      {visibleItems.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5">
          {visibleItems.map((stream) => (
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

      {/* "Nothing shown here, N streams hidden" hint — fires when the section is
          collapsed, or in auto mode with no signaling streams to surface. */}
      {showCollapsedHint && items.length > 0 && visibleItems.length === 0 && (
        <button
          type="button"
          onClick={onExpand ?? onCycle}
          className="mx-3 mt-1 px-3 py-2 w-[calc(100%-1.5rem)] rounded-md bg-muted/30 border border-dashed border-border/50 cursor-pointer hover:bg-muted/50 transition-colors text-center"
        >
          <span className="text-xs text-muted-foreground">
            {items.length} more stream{items.length !== 1 ? "s" : ""} — click to expand or use{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">⌘K</kbd>
          </span>
        </button>
      )}

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
  state?: CollapseState
  onCycle?: () => void
  onExpand?: () => void
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
  state = "open",
  onCycle,
  onExpand,
  scrollContainerRef,
}: SmartSectionProps) {
  const config = SMART_SECTIONS[section]

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
      state={state}
      onCycle={onCycle}
      onExpand={onExpand}
      showCollapsedHint={config.showCollapsedHint}
      alwaysShowAll={config.alwaysShowAll}
      compact={config.compact}
      showPreviewOnHover={config.showPreviewOnHover}
      scrollContainerRef={scrollContainerRef}
    />
  )
}
