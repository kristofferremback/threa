import { Hash, Lock, Plus, Settings, ChevronDown, MoreHorizontal, LogOut, Pin, UserPlus } from "lucide-react"
import { clsx } from "clsx"
import { Avatar, Dropdown, DropdownItem, DropdownDivider, ThemeSelector } from "../ui"
import type { Channel, Workspace } from "../../types"

interface SidebarProps {
  workspace: Workspace
  channels: Channel[]
  activeChannelSlug: string | null
  onSelectChannel: (channel: Channel) => void
  onCreateChannel: () => void
  onChannelSettings: (channel: Channel) => void
  onInvitePeople: () => void
  onLogout: () => void
}

export function Sidebar({
  workspace,
  channels,
  activeChannelSlug,
  onSelectChannel,
  onCreateChannel,
  onChannelSettings,
  onInvitePeople,
  onLogout,
}: SidebarProps) {
  return (
    <div
      className="w-64 flex-none flex flex-col h-full"
      style={{ background: "var(--bg-secondary)", borderRight: "1px solid var(--border-subtle)" }}
    >
      <WorkspaceHeader workspace={workspace} onInvitePeople={onInvitePeople} />
      <ChannelList
        channels={channels}
        activeChannelSlug={activeChannelSlug}
        onSelectChannel={onSelectChannel}
        onCreateChannel={onCreateChannel}
        onChannelSettings={onChannelSettings}
      />
      <UserFooter onLogout={onLogout} />
    </div>
  )
}

interface WorkspaceHeaderProps {
  workspace: Workspace
  onInvitePeople: () => void
}

function WorkspaceHeader({ workspace, onInvitePeople }: WorkspaceHeaderProps) {
  return (
    <div
      className="p-4 flex items-center justify-between"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
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

interface ChannelListProps {
  channels: Channel[]
  activeChannelSlug: string | null
  onSelectChannel: (channel: Channel) => void
  onCreateChannel: () => void
  onChannelSettings: (channel: Channel) => void
}

function ChannelList({
  channels,
  activeChannelSlug,
  onSelectChannel,
  onCreateChannel,
  onChannelSettings,
}: ChannelListProps) {
  return (
    <div className="flex-1 overflow-y-auto p-2">
      <div className="mb-2 px-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          Channels
        </span>
        <button
          onClick={onCreateChannel}
          className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors"
          style={{ color: "var(--text-muted)" }}
          title="Add channel"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-0.5">
        {channels.map((channel) => (
          <ChannelItem
            key={channel.id}
            channel={channel}
            isActive={activeChannelSlug === channel.slug}
            onClick={() => onSelectChannel(channel)}
            onSettings={() => onChannelSettings(channel)}
          />
        ))}
      </div>
    </div>
  )
}

interface ChannelItemProps {
  channel: Channel
  isActive: boolean
  onClick: () => void
  onSettings: () => void
}

function ChannelItem({ channel, isActive, onClick, onSettings }: ChannelItemProps) {
  const isPrivate = channel.visibility === "private"
  const Icon = isPrivate ? Lock : Hash

  return (
    <div
      className={clsx(
        "w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 transition-colors group",
        isActive ? "bg-[var(--hover-overlay-strong)]" : "hover:bg-[var(--hover-overlay)]",
      )}
    >
      <button onClick={onClick} className="flex items-center gap-2 flex-1 min-w-0">
        <Icon
          className="h-4 w-4 flex-shrink-0"
          style={{ color: isActive ? "var(--accent-primary)" : "var(--text-muted)" }}
        />
        <span
          className="text-sm truncate flex-1 text-left"
          style={{
            color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
            fontWeight: channel.unread_count > 0 ? 600 : 400,
          }}
        >
          {channel.name.replace("#", "")}
        </span>
      </button>

      {channel.unread_count > 0 && (
        <span
          className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
          style={{ background: "var(--accent-secondary)", color: "white" }}
        >
          {channel.unread_count}
        </span>
      )}

      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <Dropdown
          align="left"
          trigger={
            <button className="p-1 rounded hover:bg-[var(--hover-overlay-strong)] transition-colors" style={{ color: "var(--text-muted)" }}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          }
        >
          <DropdownItem onClick={() => {}} icon={<Pin className="h-4 w-4" />}>
            Pin channel
          </DropdownItem>
          <DropdownDivider />
          <DropdownItem onClick={onSettings} icon={<Settings className="h-4 w-4" />}>
            Channel settings
          </DropdownItem>
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
