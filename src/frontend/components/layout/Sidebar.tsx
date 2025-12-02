import {
  Hash,
  Lock,
  Plus,
  Settings,
  MoreHorizontal,
  LogOut,
  Pin,
  UserPlus,
  Search,
  Command,
  Bell,
  PinOff,
  Compass,
  PanelRightOpen,
  MessageCircle,
  User,
  Brain,
  Archive,
  BookOpen,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { useSidebarCollapse, type CollapseState, type SectionId } from "../../hooks/useSidebarCollapse"
import { clsx } from "clsx"
import { Avatar, Dropdown, DropdownItem, DropdownDivider, ThemeSelector } from "../ui"
import type { Stream, Workspace, OpenMode } from "../../types"
import { getOpenMode } from "../../types"

interface User {
  id: string
  name: string | null
  email: string
}

interface UserProfile {
  displayName: string | null
  title: string | null
}

interface SidebarProps {
  workspace: Workspace
  streams: Stream[]
  users: User[]
  activeStreamSlug: string | null
  currentUserId?: string
  currentUserProfile?: UserProfile | null
  onSelectStream: (stream: Stream, mode: OpenMode) => void
  onStartDM: (userId: string) => void
  onCreateChannel: () => void
  onCreateDM?: () => void
  onCreateThinkingSpace?: () => void
  onStreamSettings: (stream: Stream) => void
  onEditProfile?: () => void
  onInvitePeople: () => void
  onLogout: () => void
  onOpenCommandPalette: () => void
  onOpenInbox?: () => void
  onOpenKnowledge?: () => void
  onBrowseChannels?: () => void
  onPinStream?: (streamId: string) => void
  onUnpinStream?: (streamId: string) => void
  onLeaveStream?: (streamId: string) => void
  onArchiveStream?: (streamId: string) => void
  onOpenSettings?: () => void
  isInboxActive?: boolean
  inboxUnreadCount?: number
}

export function Sidebar({
  workspace,
  streams,
  users,
  activeStreamSlug,
  currentUserId,
  onSelectStream,
  onStartDM,
  onCreateChannel,
  onCreateDM,
  onCreateThinkingSpace,
  onStreamSettings,
  onEditProfile,
  onInvitePeople,
  onLogout,
  onOpenCommandPalette,
  onOpenInbox,
  onOpenKnowledge,
  onBrowseChannels,
  onPinStream,
  onUnpinStream,
  onLeaveStream,
  onArchiveStream,
  onOpenSettings,
  isInboxActive = false,
  inboxUnreadCount = 0,
  currentUserProfile,
}: SidebarProps) {
  const { getState, toggle, toggleHard } = useSidebarCollapse({ workspaceId: workspace.id })

  // Filter to only show channels the user is a member of
  const memberChannels = streams.filter((s) => s.streamType === "channel" && s.isMember)
  // Use truthy check for pinnedAt since it might be undefined or null
  const pinnedChannels = memberChannels.filter((s) => !!s.pinnedAt)
  const unpinnedChannels = memberChannels.filter((s) => !s.pinnedAt)

  // Thinking spaces
  const thinkingSpaces = streams.filter((s) => s.streamType === "thinking_space" && s.isMember)

  // DMs the user is part of
  const directMessages = streams.filter((s) => s.streamType === "dm" && s.isMember)

  // Other users in workspace (excluding current user and AI personas like Ariadne)
  const otherUsers = users.filter((u) => u.id !== currentUserId && !u.email.endsWith("@threa.ai"))

  const hasNoChannels = memberChannels.length === 0

  return (
    <div
      className="w-64 flex-none flex flex-col h-full"
      style={{ background: "var(--bg-secondary)", borderRight: "1px solid var(--border-subtle)" }}
    >
      <WorkspaceHeader workspace={workspace} onInvitePeople={onInvitePeople} />
      <ChannelSearch onOpenCommandPalette={onOpenCommandPalette} />

      <div className="px-2 py-1 space-y-0.5">
        <button
          onClick={onOpenInbox}
          className={clsx(
            "w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 transition-colors",
            isInboxActive ? "bg-[var(--hover-overlay-strong)]" : "hover:bg-[var(--hover-overlay)]",
          )}
        >
          <Bell
            className="h-4 w-4 flex-shrink-0"
            style={{ color: isInboxActive ? "var(--accent-primary)" : "var(--text-muted)" }}
          />
          <span
            className="text-sm flex-1"
            style={{
              color: isInboxActive ? "var(--text-primary)" : "var(--text-secondary)",
              fontWeight: inboxUnreadCount > 0 ? 600 : 400,
            }}
          >
            Activity
          </span>
          {inboxUnreadCount > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: "var(--accent-primary)", color: "white" }}
            >
              {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
            </span>
          )}
        </button>
        {onOpenKnowledge && (
          <button
            onClick={onOpenKnowledge}
            className="w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 transition-colors hover:bg-[var(--hover-overlay)]"
          >
            <BookOpen className="h-4 w-4 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
            <span className="text-sm flex-1" style={{ color: "var(--text-secondary)" }}>
              Knowledge
            </span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {hasNoChannels ? (
          <EmptyChannelsState onBrowseChannels={onBrowseChannels} onCreateChannel={onCreateChannel} />
        ) : (
          <>
            {pinnedChannels.length > 0 && (
              <StreamSection
                title="Pinned"
                sectionId="pinned"
                streams={pinnedChannels}
                activeStreamSlug={activeStreamSlug}
                collapseState={getState("pinned")}
                onToggleCollapse={() => toggle("pinned")}
                onToggleHardCollapse={() => toggleHard("pinned")}
                onSelectStream={onSelectStream}
                onStreamSettings={onStreamSettings}
                onPinStream={onPinStream}
                onUnpinStream={onUnpinStream}
                onLeaveStream={onLeaveStream}
              />
            )}

            <StreamSection
              title="Channels"
              sectionId="channels"
              streams={unpinnedChannels}
              activeStreamSlug={activeStreamSlug}
              collapseState={getState("channels")}
              onToggleCollapse={() => toggle("channels")}
              onToggleHardCollapse={() => toggleHard("channels")}
              onSelectStream={onSelectStream}
              onCreateChannel={onCreateChannel}
              onBrowseChannels={onBrowseChannels}
              onStreamSettings={onStreamSettings}
              onPinStream={onPinStream}
              onUnpinStream={onUnpinStream}
              onLeaveStream={onLeaveStream}
            />
          </>
        )}

        {/* Thinking Spaces Section */}
        <ThinkingSpacesSection
          thinkingSpaces={thinkingSpaces}
          activeStreamSlug={activeStreamSlug}
          collapseState={getState("thinkingSpaces")}
          onToggleCollapse={() => toggle("thinkingSpaces")}
          onToggleHardCollapse={() => toggleHard("thinkingSpaces")}
          onSelectStream={onSelectStream}
          onCreateThinkingSpace={onCreateThinkingSpace}
          onArchiveStream={onArchiveStream}
        />

        {/* Direct Messages Section */}
        <DMSection
          dmStreams={directMessages}
          users={otherUsers}
          activeStreamSlug={activeStreamSlug}
          currentUserId={currentUserId}
          collapseState={getState("directMessages")}
          onToggleCollapse={() => toggle("directMessages")}
          onToggleHardCollapse={() => toggleHard("directMessages")}
          onSelectStream={onSelectStream}
          onStartDM={onStartDM}
          onCreateDM={onCreateDM}
          onPinStream={onPinStream}
          onUnpinStream={onUnpinStream}
        />
      </div>

      <UserFooter onLogout={onLogout} onEditProfile={onEditProfile} onOpenSettings={onOpenSettings} profile={currentUserProfile} />
    </div>
  )
}

interface EmptyChannelsStateProps {
  onBrowseChannels?: () => void
  onCreateChannel: () => void
}

function EmptyChannelsState({ onBrowseChannels, onCreateChannel }: EmptyChannelsStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
        style={{ background: "var(--bg-tertiary)" }}
      >
        <Compass className="h-6 w-6" style={{ color: "var(--text-muted)" }} />
      </div>
      <h3 className="text-sm font-medium mb-1" style={{ color: "var(--text-primary)" }}>
        No channels yet
      </h3>
      <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
        Join a channel to start collaborating with your team
      </p>
      <div className="flex flex-col gap-2 w-full">
        <button
          onClick={onBrowseChannels}
          className="w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          style={{
            background: "var(--accent-primary)",
            color: "white",
          }}
        >
          <Compass className="h-4 w-4" />
          Browse channels
        </button>
        <button
          onClick={onCreateChannel}
          className="w-full px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
          style={{
            background: "var(--bg-tertiary)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <Plus className="h-4 w-4" />
          Create channel
        </button>
      </div>
    </div>
  )
}

interface ChannelSearchProps {
  onOpenCommandPalette: () => void
}

function ChannelSearch({ onOpenCommandPalette }: ChannelSearchProps) {
  return (
    <div className="px-3 py-2">
      <button
        onClick={onOpenCommandPalette}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
        style={{
          background: "var(--bg-tertiary)",
          color: "var(--text-muted)",
          border: "1px solid var(--border-subtle)",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--border-strong)")}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border-subtle)")}
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Find channels...</span>
        <kbd
          className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded"
          style={{ background: "var(--bg-secondary)", color: "var(--text-muted)" }}
        >
          <Command className="h-3 w-3" />P
        </kbd>
      </button>
    </div>
  )
}

interface WorkspaceHeaderProps {
  workspace: Workspace
  onInvitePeople: () => void
}

function WorkspaceHeader({ workspace, onInvitePeople }: WorkspaceHeaderProps) {
  return (
    <div className="p-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <div className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer hover:bg-[var(--hover-overlay)] -m-2 p-2 rounded-lg transition-colors">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center font-semibold text-sm flex-shrink-0"
          style={{ background: "var(--gradient-accent)" }}
        >
          {workspace.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div
            className="font-semibold text-sm truncate"
            style={{ color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}
          >
            {workspace.name}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {workspace.plan_tier}
          </div>
        </div>
      </div>
      <button
        onClick={onInvitePeople}
        className="p-2 rounded-lg transition-colors flex-shrink-0"
        style={{ color: "var(--text-muted)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay-strong)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        title="Invite people"
      >
        <UserPlus className="h-4 w-4" />
      </button>
    </div>
  )
}

interface StreamSectionProps {
  title: string
  sectionId: SectionId
  streams: Stream[]
  activeStreamSlug: string | null
  collapseState: CollapseState
  onToggleCollapse: () => void
  onToggleHardCollapse: () => void
  onSelectStream: (stream: Stream, mode: OpenMode) => void
  onCreateChannel?: () => void
  onBrowseChannels?: () => void
  onStreamSettings: (stream: Stream) => void
  onPinStream?: (streamId: string) => void
  onUnpinStream?: (streamId: string) => void
  onLeaveStream?: (streamId: string) => void
}

function StreamSection({
  title,
  streams,
  activeStreamSlug,
  collapseState,
  onToggleCollapse,
  onToggleHardCollapse,
  onSelectStream,
  onCreateChannel,
  onBrowseChannels,
  onStreamSettings,
  onPinStream,
  onUnpinStream,
  onLeaveStream,
}: StreamSectionProps) {
  // Calculate total unread count for hard collapse mode
  const totalUnread = streams.reduce((sum, s) => sum + (s.unreadCount || 0), 0)

  // Filter streams for soft collapse mode (only show those with unread)
  const visibleStreams =
    collapseState === "soft" ? streams.filter((s) => s.unreadCount > 0) : streams

  const isHardCollapsed = collapseState === "hard"
  const ChevronIcon = isHardCollapsed ? ChevronRight : ChevronDown

  return (
    <div className="mb-4">
      <div
        className="mb-2 px-2 flex items-center justify-between cursor-pointer select-none group"
        onClick={onToggleCollapse}
        onContextMenu={(e) => {
          e.preventDefault()
          onToggleHardCollapse()
        }}
        title="Click to toggle, right-click to fully collapse"
      >
        <div className="flex items-center gap-1">
          <ChevronIcon
            className="h-3 w-3 transition-transform"
            style={{ color: "var(--text-muted)" }}
          />
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            {title}
          </span>
          {isHardCollapsed && totalUnread > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full font-medium ml-1"
              style={{ background: "var(--accent-secondary)", color: "white" }}
            >
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {onBrowseChannels && (
            <button
              onClick={onBrowseChannels}
              className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors opacity-0 group-hover:opacity-100"
              style={{ color: "var(--text-muted)" }}
              title="Browse channels"
            >
              <Compass className="h-3.5 w-3.5" />
            </button>
          )}
          {onCreateChannel && (
            <button
              onClick={onCreateChannel}
              className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors opacity-0 group-hover:opacity-100"
              style={{ color: "var(--text-muted)" }}
              title="Add channel"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {!isHardCollapsed && (
        <div className="space-y-0.5">
          {visibleStreams.map((stream) => (
            <StreamItem
              key={stream.id}
              stream={stream}
              isActive={activeStreamSlug === stream.slug}
              onClick={(e) => onSelectStream(stream, getOpenMode(e))}
              onSettings={() => onStreamSettings(stream)}
              onPin={onPinStream ? () => onPinStream(stream.id) : undefined}
              onUnpin={onUnpinStream ? () => onUnpinStream(stream.id) : undefined}
              onLeave={onLeaveStream ? () => onLeaveStream(stream.id) : undefined}
            />
          ))}
          {collapseState === "soft" && visibleStreams.length === 0 && (
            <div className="px-2 py-1 text-xs" style={{ color: "var(--text-muted)" }}>
              No unread channels
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface StreamItemProps {
  stream: Stream
  isActive: boolean
  onClick: (e: React.MouseEvent) => void
  onSettings: () => void
  onPin?: () => void
  onUnpin?: () => void
  onLeave?: () => void
}

function StreamItem({ stream, isActive, onClick, onSettings, onPin, onUnpin, onLeave }: StreamItemProps) {
  const isPrivate = stream.visibility === "private"
  const isPinned = !!stream.pinnedAt
  const Icon = isPrivate ? Lock : Hash

  return (
    <div
      className={clsx(
        "w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 transition-colors group",
        isActive ? "bg-[var(--hover-overlay-strong)]" : "hover:bg-[var(--hover-overlay)]",
      )}
    >
      <button
        onClick={onClick}
        className="flex items-center gap-2 flex-1 min-w-0"
        title="Click to open, ⌥+click to open to side, ⌘+click for new tab"
      >
        <Icon
          className="h-4 w-4 flex-shrink-0"
          style={{ color: isActive ? "var(--accent-primary)" : "var(--text-muted)" }}
        />
        <span
          className="text-sm truncate flex-1 text-left"
          style={{
            color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
            fontWeight: stream.unreadCount > 0 ? 600 : 400,
          }}
        >
          {(stream.name || "").replace("#", "")}
        </span>
      </button>

      {stream.unreadCount > 0 && (
        <span
          className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
          style={{ background: "var(--accent-secondary)", color: "white" }}
        >
          {stream.unreadCount}
        </span>
      )}

      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 flex items-center gap-0.5">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClick({ ...e, altKey: true } as React.MouseEvent)
          }}
          className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors"
          style={{ color: "var(--text-muted)" }}
          title="Open to side"
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
        </button>
        <Dropdown
          align="left"
          trigger={
            <button
              className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          }
        >
          {isPinned ? (
            <DropdownItem onClick={onUnpin} icon={<PinOff className="h-4 w-4" />}>
              Unpin channel
            </DropdownItem>
          ) : (
            <DropdownItem onClick={onPin} icon={<Pin className="h-4 w-4" />}>
              Pin channel
            </DropdownItem>
          )}
          <DropdownDivider />
          <DropdownItem onClick={onSettings} icon={<Settings className="h-4 w-4" />}>
            Channel settings
          </DropdownItem>
          {onLeave && (
            <>
              <DropdownDivider />
              <DropdownItem onClick={onLeave} icon={<LogOut className="h-4 w-4" />} variant="danger">
                Leave channel
              </DropdownItem>
            </>
          )}
        </Dropdown>
      </div>
    </div>
  )
}

// ==========================================================================
// Thinking Spaces Section
// ==========================================================================

interface ThinkingSpacesSectionProps {
  thinkingSpaces: Stream[]
  activeStreamSlug: string | null
  collapseState: CollapseState
  onToggleCollapse: () => void
  onToggleHardCollapse: () => void
  onSelectStream: (stream: Stream, mode: OpenMode) => void
  onCreateThinkingSpace?: () => void
  onArchiveStream?: (streamId: string) => void
}

function ThinkingSpacesSection({
  thinkingSpaces,
  activeStreamSlug,
  collapseState,
  onToggleCollapse,
  onToggleHardCollapse,
  onSelectStream,
  onCreateThinkingSpace,
  onArchiveStream,
}: ThinkingSpacesSectionProps) {
  // Calculate total unread count for hard collapse mode
  const totalUnread = thinkingSpaces.reduce((sum, s) => sum + (s.unreadCount || 0), 0)

  // Filter spaces for soft collapse mode (only show those with unread)
  const visibleSpaces =
    collapseState === "soft" ? thinkingSpaces.filter((s) => s.unreadCount > 0) : thinkingSpaces

  const isHardCollapsed = collapseState === "hard"
  const ChevronIcon = isHardCollapsed ? ChevronRight : ChevronDown

  return (
    <div className="mb-4">
      <div
        className="mb-2 px-2 flex items-center justify-between cursor-pointer select-none group"
        onClick={onToggleCollapse}
        onContextMenu={(e) => {
          e.preventDefault()
          onToggleHardCollapse()
        }}
        title="Click to toggle, right-click to fully collapse"
      >
        <div className="flex items-center gap-1">
          <ChevronIcon
            className="h-3 w-3 transition-transform"
            style={{ color: "var(--text-muted)" }}
          />
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Thinking Spaces
          </span>
          {isHardCollapsed && totalUnread > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full font-medium ml-1"
              style={{ background: "var(--accent-secondary)", color: "white" }}
            >
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {onCreateThinkingSpace && (
            <button
              onClick={onCreateThinkingSpace}
              className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors opacity-0 group-hover:opacity-100"
              style={{ color: "var(--text-muted)" }}
              title="New thinking space"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {!isHardCollapsed && (
        <div className="space-y-0.5">
          {thinkingSpaces.length === 0 ? (
            <button
              onClick={onCreateThinkingSpace}
              className="w-full text-left px-2 py-2 rounded-lg flex items-center gap-2 transition-colors hover:bg-[var(--hover-overlay)]"
            >
              <Brain className="h-4 w-4 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                Start thinking with Ariadne...
              </span>
            </button>
          ) : (
            <>
              {visibleSpaces.map((space) => (
                <ThinkingSpaceItem
                  key={space.id}
                  space={space}
                  isActive={activeStreamSlug === space.slug || activeStreamSlug === space.id}
                  onClick={(e) => onSelectStream(space, getOpenMode(e))}
                  onArchive={onArchiveStream ? () => onArchiveStream(space.id) : undefined}
                />
              ))}
              {collapseState === "soft" && visibleSpaces.length === 0 && thinkingSpaces.length > 0 && (
                <div className="px-2 py-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  No unread spaces
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface ThinkingSpaceItemProps {
  space: Stream
  isActive: boolean
  onClick: (e: React.MouseEvent) => void
  onArchive?: () => void
}

function ThinkingSpaceItem({ space, isActive, onClick, onArchive }: ThinkingSpaceItemProps) {
  return (
    <div
      className={clsx(
        "w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 transition-colors group",
        isActive ? "bg-[var(--hover-overlay-strong)]" : "hover:bg-[var(--hover-overlay)]",
      )}
    >
      <button onClick={onClick} className="flex items-center gap-2 flex-1 min-w-0">
        <Brain
          className="h-4 w-4 flex-shrink-0"
          style={{ color: isActive ? "var(--accent-primary)" : "var(--text-muted)" }}
        />
        <span
          className="text-sm truncate flex-1 text-left"
          style={{
            color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
            fontWeight: space.unreadCount > 0 ? 600 : 400,
          }}
        >
          {space.name || "Untitled thinking space"}
        </span>
      </button>

      {space.unreadCount > 0 && (
        <span
          className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
          style={{ background: "var(--accent-secondary)", color: "white" }}
        >
          {space.unreadCount}
        </span>
      )}

      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 flex items-center gap-0.5">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClick({ ...e, altKey: true } as React.MouseEvent)
          }}
          className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors"
          style={{ color: "var(--text-muted)" }}
          title="Open to side"
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
        </button>
        <Dropdown
          align="left"
          trigger={
            <button
              className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          }
        >
          {onArchive && (
            <DropdownItem onClick={onArchive} icon={<Archive className="h-4 w-4" />} variant="danger">
              Archive space
            </DropdownItem>
          )}
        </Dropdown>
      </div>
    </div>
  )
}

// ==========================================================================
// DM Section - Shows all users, ordered by recency
// ==========================================================================

interface DMSectionProps {
  dmStreams: Stream[]
  users: User[]
  activeStreamSlug: string | null
  currentUserId?: string
  collapseState: CollapseState
  onToggleCollapse: () => void
  onToggleHardCollapse: () => void
  onSelectStream: (stream: Stream, mode: OpenMode) => void
  onStartDM: (userId: string) => void
  onCreateDM?: () => void
  onPinStream?: (streamId: string) => void
  onUnpinStream?: (streamId: string) => void
}

// Helper to get the "other" user's ID from a DM's metadata
function getDMParticipantIds(dm: Stream): string[] {
  const metadata = dm.metadata as { participant_ids?: string[] } | undefined
  return metadata?.participant_ids || []
}

// Get display name for user
function getUserDisplayName(user: User): string {
  return user.name || user.email.split("@")[0]
}

function DMSection({
  dmStreams,
  users,
  activeStreamSlug,
  currentUserId,
  collapseState,
  onToggleCollapse,
  onToggleHardCollapse,
  onSelectStream,
  onStartDM,
  onCreateDM,
  onPinStream,
  onUnpinStream,
}: DMSectionProps) {
  // Build a map of userId -> DM stream (for 1-on-1 DMs)
  const userToDM = new Map<string, Stream>()
  for (const dm of dmStreams) {
    const participantIds = getDMParticipantIds(dm)
    // Only map 1-on-1 DMs (2 participants)
    if (participantIds.length === 2) {
      const otherUserId = participantIds.find((id) => id !== currentUserId)
      if (otherUserId) {
        userToDM.set(otherUserId, dm)
      }
    }
  }

  // Group DMs (more than 2 participants)
  const groupDMs = dmStreams.filter((dm) => getDMParticipantIds(dm).length > 2)

  // Create sorted list: users with DMs first (by updatedAt), then users without DMs (by name)
  const sortedUsers = [...users].sort((a, b) => {
    const dmA = userToDM.get(a.id)
    const dmB = userToDM.get(b.id)

    // Both have DMs - sort by updatedAt descending
    if (dmA && dmB) {
      const timeA = dmA.updatedAt ? new Date(dmA.updatedAt).getTime() : 0
      const timeB = dmB.updatedAt ? new Date(dmB.updatedAt).getTime() : 0
      return timeB - timeA
    }

    // Only A has DM - A comes first
    if (dmA && !dmB) return -1

    // Only B has DM - B comes first
    if (!dmA && dmB) return 1

    // Neither has DM - sort by name
    const nameA = getUserDisplayName(a).toLowerCase()
    const nameB = getUserDisplayName(b).toLowerCase()
    return nameA.localeCompare(nameB)
  })

  // Calculate total unread for hard collapse mode
  const totalUnread = dmStreams.reduce((sum, s) => sum + (s.unreadCount || 0), 0)

  // For soft collapse, filter to only show users/groups with unread
  const visibleGroupDMs =
    collapseState === "soft" ? groupDMs.filter((dm) => dm.unreadCount > 0) : groupDMs
  const visibleUsers =
    collapseState === "soft"
      ? sortedUsers.filter((user) => {
          const dm = userToDM.get(user.id)
          return dm && dm.unreadCount > 0
        })
      : sortedUsers

  const isHardCollapsed = collapseState === "hard"
  const ChevronIcon = isHardCollapsed ? ChevronRight : ChevronDown

  return (
    <div className="mb-4">
      <div
        className="mb-2 px-2 flex items-center justify-between cursor-pointer select-none group"
        onClick={onToggleCollapse}
        onContextMenu={(e) => {
          e.preventDefault()
          onToggleHardCollapse()
        }}
        title="Click to toggle, right-click to fully collapse"
      >
        <div className="flex items-center gap-1">
          <ChevronIcon
            className="h-3 w-3 transition-transform"
            style={{ color: "var(--text-muted)" }}
          />
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Direct messages
          </span>
          {isHardCollapsed && totalUnread > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full font-medium ml-1"
              style={{ background: "var(--accent-secondary)", color: "white" }}
            >
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {onCreateDM && (
            <button
              onClick={onCreateDM}
              className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors opacity-0 group-hover:opacity-100"
              style={{ color: "var(--text-muted)" }}
              title="New group message"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {!isHardCollapsed && (
        <div className="space-y-0.5">
          {/* Group DMs first */}
          {visibleGroupDMs.map((dm) => (
            <DMItem
              key={dm.id}
              stream={dm}
              displayName={dm.name || "Group"}
              isActive={activeStreamSlug === dm.id || activeStreamSlug === dm.slug}
              onClick={(e) => onSelectStream(dm, getOpenMode(e))}
              onPin={onPinStream ? () => onPinStream(dm.id) : undefined}
              onUnpin={onUnpinStream ? () => onUnpinStream(dm.id) : undefined}
            />
          ))}

          {/* Individual users */}
          {visibleUsers.map((user) => {
            const dm = userToDM.get(user.id)
            return (
              <UserDMItem
                key={user.id}
                user={user}
                dm={dm}
                isActive={dm ? activeStreamSlug === dm.id || activeStreamSlug === dm.slug : false}
                onClick={(e) => {
                  if (dm) {
                    onSelectStream(dm, getOpenMode(e))
                  } else {
                    onStartDM(user.id)
                  }
                }}
                onPin={dm && onPinStream ? () => onPinStream(dm.id) : undefined}
                onUnpin={dm && onUnpinStream ? () => onUnpinStream(dm.id) : undefined}
              />
            )
          })}

          {collapseState === "soft" && visibleGroupDMs.length === 0 && visibleUsers.length === 0 && (
            <div className="px-2 py-1 text-xs" style={{ color: "var(--text-muted)" }}>
              No unread messages
            </div>
          )}

          {collapseState === "open" && sortedUsers.length === 0 && groupDMs.length === 0 && (
            <div className="px-2 py-3 text-center">
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                No other users in workspace
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface DMItemProps {
  stream: Stream
  displayName: string
  isActive: boolean
  onClick: (e: React.MouseEvent) => void
  onPin?: () => void
  onUnpin?: () => void
}

function DMItem({ stream, displayName, isActive, onClick, onPin, onUnpin }: DMItemProps) {
  const isPinned = !!stream.pinnedAt

  return (
    <div
      className={clsx(
        "w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 transition-colors group",
        isActive ? "bg-[var(--hover-overlay-strong)]" : "hover:bg-[var(--hover-overlay)]",
      )}
    >
      <button
        onClick={onClick}
        className="flex items-center gap-2 flex-1 min-w-0"
        title="Click to open, ⌥+click to open to side, ⌘+click for new tab"
      >
        <MessageCircle
          className="h-4 w-4 flex-shrink-0"
          style={{ color: isActive ? "var(--accent-primary)" : "var(--text-muted)" }}
        />
        <span
          className="text-sm truncate flex-1 text-left"
          style={{
            color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
            fontWeight: stream.unreadCount > 0 ? 600 : 400,
          }}
        >
          {displayName}
        </span>
      </button>

      {stream.unreadCount > 0 && (
        <span
          className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
          style={{ background: "var(--accent-secondary)", color: "white" }}
        >
          {stream.unreadCount}
        </span>
      )}

      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 flex items-center gap-0.5">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClick({ ...e, altKey: true } as React.MouseEvent)
          }}
          className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors"
          style={{ color: "var(--text-muted)" }}
          title="Open to side"
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
        </button>
        <Dropdown
          align="left"
          trigger={
            <button
              className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          }
        >
          {isPinned ? (
            <DropdownItem onClick={onUnpin} icon={<PinOff className="h-4 w-4" />}>
              Unpin conversation
            </DropdownItem>
          ) : (
            <DropdownItem onClick={onPin} icon={<Pin className="h-4 w-4" />}>
              Pin conversation
            </DropdownItem>
          )}
        </Dropdown>
      </div>
    </div>
  )
}

// Individual user item (may or may not have existing DM)
interface UserDMItemProps {
  user: User
  dm: Stream | undefined
  isActive: boolean
  onClick: (e: React.MouseEvent) => void
  onPin?: () => void
  onUnpin?: () => void
}

function UserDMItem({ user, dm, isActive, onClick, onPin, onUnpin }: UserDMItemProps) {
  const isPinned = dm ? !!dm.pinnedAt : false
  const displayName = getUserDisplayName(user)
  const hasUnread = dm && dm.unreadCount > 0

  return (
    <div
      className={clsx(
        "w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 transition-colors group",
        isActive ? "bg-[var(--hover-overlay-strong)]" : "hover:bg-[var(--hover-overlay)]",
      )}
    >
      <button
        onClick={onClick}
        className="flex items-center gap-2 flex-1 min-w-0"
        title="Click to open, ⌥+click to open to side, ⌘+click for new tab"
      >
        <Avatar name={displayName} size="xs" />
        <span
          className="text-sm truncate flex-1 text-left"
          style={{
            color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
            fontWeight: hasUnread ? 600 : 400,
          }}
        >
          {displayName}
        </span>
      </button>

      {hasUnread && (
        <span
          className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
          style={{ background: "var(--accent-secondary)", color: "white" }}
        >
          {dm.unreadCount}
        </span>
      )}

      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 flex items-center gap-0.5">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClick({ ...e, altKey: true } as React.MouseEvent)
          }}
          className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors"
          style={{ color: "var(--text-muted)" }}
          title="Open to side"
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
        </button>
        {dm && (
          <Dropdown
            align="left"
            trigger={
              <button
                className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors"
                style={{ color: "var(--text-muted)" }}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            }
          >
            {isPinned ? (
              <DropdownItem onClick={onUnpin} icon={<PinOff className="h-4 w-4" />}>
                Unpin conversation
              </DropdownItem>
            ) : (
              <DropdownItem onClick={onPin} icon={<Pin className="h-4 w-4" />}>
                Pin conversation
              </DropdownItem>
            )}
          </Dropdown>
        )}
      </div>
    </div>
  )
}

interface UserFooterProps {
  onLogout: () => void
  onEditProfile?: () => void
  onOpenSettings?: () => void
  profile?: UserProfile | null
}

function UserFooter({ onLogout, onEditProfile, onOpenSettings, profile }: UserFooterProps) {
  const displayName = profile?.displayName || "You"
  const title = profile?.title

  return (
    <div className="p-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <div className="flex items-center gap-2">
        <Avatar name={displayName} size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
            {displayName}
          </div>
          {title ? (
            <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
              {title}
            </div>
          ) : (
            <div className="text-xs flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: "var(--success)" }} />
              <span style={{ color: "var(--text-muted)" }}>Online</span>
            </div>
          )}
        </div>
        <Dropdown
          align="right"
          direction="up"
          trigger={
            <button
              className="p-1.5 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors"
              style={{ color: "var(--text-muted)" }}
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          }
        >
          <ThemeSelector />
          <DropdownDivider />
          {onEditProfile && (
            <DropdownItem onClick={onEditProfile} icon={<User className="h-4 w-4" />}>
              Edit profile
            </DropdownItem>
          )}
          {onOpenSettings && (
            <DropdownItem onClick={onOpenSettings} icon={<Settings className="h-4 w-4" />}>
              Preferences
            </DropdownItem>
          )}
          <DropdownDivider />
          <DropdownItem onClick={onLogout} icon={<LogOut className="h-4 w-4" />} variant="danger">
            Sign out
          </DropdownItem>
        </Dropdown>
      </div>
    </div>
  )
}
