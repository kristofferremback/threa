import { useState } from "react"
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
  LogIn,
  Compass,
  PanelRightOpen,
} from "lucide-react"
import { clsx } from "clsx"
import { Avatar, Dropdown, DropdownItem, DropdownDivider, ThemeSelector } from "../ui"
import type { Stream, Workspace, OpenMode } from "../../types"
import { getOpenMode } from "../../types"

interface SidebarProps {
  workspace: Workspace
  streams: Stream[]
  activeStreamSlug: string | null
  onSelectStream: (stream: Stream, mode: OpenMode) => void
  onCreateChannel: () => void
  onStreamSettings: (stream: Stream) => void
  onInvitePeople: () => void
  onLogout: () => void
  onOpenCommandPalette: () => void
  onOpenInbox?: () => void
  onBrowseChannels?: () => void
  onPinStream?: (streamId: string) => void
  onUnpinStream?: (streamId: string) => void
  onLeaveStream?: (streamId: string) => void
  isInboxActive?: boolean
  inboxUnreadCount?: number
}

export function Sidebar({
  workspace,
  streams,
  activeStreamSlug,
  onSelectStream,
  onCreateChannel,
  onStreamSettings,
  onInvitePeople,
  onLogout,
  onOpenCommandPalette,
  onOpenInbox,
  onBrowseChannels,
  onPinStream,
  onUnpinStream,
  onLeaveStream,
  isInboxActive = false,
  inboxUnreadCount = 0,
}: SidebarProps) {
  // Filter to only show channels the user is a member of
  const memberChannels = streams.filter((s) => s.streamType === "channel" && s.isMember)
  // Use truthy check for pinnedAt since it might be undefined or null
  const pinnedChannels = memberChannels.filter((s) => !!s.pinnedAt)
  const unpinnedChannels = memberChannels.filter((s) => !s.pinnedAt)

  const hasNoChannels = memberChannels.length === 0

  return (
    <div
      className="w-64 flex-none flex flex-col h-full"
      style={{ background: "var(--bg-secondary)", borderRight: "1px solid var(--border-subtle)" }}
    >
      <WorkspaceHeader workspace={workspace} onInvitePeople={onInvitePeople} />
      <ChannelSearch onOpenCommandPalette={onOpenCommandPalette} />

      <div className="px-2 py-1">
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
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {hasNoChannels ? (
          <EmptyChannelsState onBrowseChannels={onBrowseChannels} onCreateChannel={onCreateChannel} />
        ) : (
          <>
            {pinnedChannels.length > 0 && (
              <StreamSection
                title="Pinned"
                streams={pinnedChannels}
                activeStreamSlug={activeStreamSlug}
                onSelectStream={onSelectStream}
                onStreamSettings={onStreamSettings}
                onPinStream={onPinStream}
                onUnpinStream={onUnpinStream}
                onLeaveStream={onLeaveStream}
              />
            )}

            <StreamSection
              title="Channels"
              streams={unpinnedChannels}
              activeStreamSlug={activeStreamSlug}
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
      </div>

      <UserFooter onLogout={onLogout} />
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
  streams: Stream[]
  activeStreamSlug: string | null
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
  onSelectStream,
  onCreateChannel,
  onBrowseChannels,
  onStreamSettings,
  onPinStream,
  onUnpinStream,
  onLeaveStream,
}: StreamSectionProps) {
  return (
    <div className="mb-4">
      <div className="mb-2 px-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          {title}
        </span>
        <div className="flex items-center gap-1">
          {onBrowseChannels && (
            <button
              onClick={onBrowseChannels}
              className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors"
              style={{ color: "var(--text-muted)" }}
              title="Browse channels"
            >
              <Compass className="h-3.5 w-3.5" />
            </button>
          )}
          {onCreateChannel && (
            <button
              onClick={onCreateChannel}
              className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors"
              style={{ color: "var(--text-muted)" }}
              title="Add channel"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-0.5">
        {streams.map((stream) => (
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
      </div>
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

interface UserFooterProps {
  onLogout: () => void
}

function UserFooter({ onLogout }: UserFooterProps) {
  return (
    <div className="p-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <div className="flex items-center gap-2">
        <Avatar name="U" size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
            You
          </div>
          <div className="text-xs flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: "var(--success)" }} />
            <span style={{ color: "var(--text-muted)" }}>Online</span>
          </div>
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
          <DropdownItem onClick={() => {}} icon={<Settings className="h-4 w-4" />}>
            Preferences
          </DropdownItem>
          <DropdownDivider />
          <DropdownItem onClick={onLogout} icon={<LogOut className="h-4 w-4" />} variant="danger">
            Sign out
          </DropdownItem>
        </Dropdown>
      </div>
    </div>
  )
}
