import { useState } from "react"
import { ChevronRight, ChevronDown, PanelRightOpen, Hash, ArrowLeft } from "lucide-react"
import { Avatar, Spinner, RelativeTime } from "../ui"
import { MessageContent } from "./MessageContent"
import type { Message, OpenMode } from "../../types"
import { getOpenMode } from "../../types"

interface ThreadContextProps {
  rootMessage: Message | null
  ancestors: Message[]
  channelName?: string
  isLoading: boolean
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
  onGoToChannel?: (channelId: string, mode: OpenMode) => void
  onChannelClick?: (channelSlug: string, e: React.MouseEvent) => void
}

export function ThreadContext({
  rootMessage,
  ancestors,
  channelName,
  isLoading,
  onOpenThread,
  onGoToChannel,
  onChannelClick,
}: ThreadContextProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)" }}>
      {/* Channel breadcrumb */}
      {rootMessage && onGoToChannel && (
        <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <button
            onClick={(e) => onGoToChannel(rootMessage.channelId, getOpenMode(e))}
            className="flex items-center gap-1.5 text-xs transition-colors hover:underline"
            style={{ color: "var(--accent-primary)" }}
            title="Go back to channel"
          >
            <ArrowLeft className="h-3 w-3" />
            <Hash className="h-3 w-3" />
            <span>{channelName || "channel"}</span>
          </button>
        </div>
      )}

      {/* Collapsible Ancestors */}
      {ancestors.length > 0 && (
        <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 w-full px-4 py-2 text-xs transition-colors hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {isExpanded ? "Hide context" : `Show ${ancestors.length} parent message${ancestors.length > 1 ? "s" : ""}`}
          </button>

          {isExpanded && (
            <div className="px-4 pb-3 space-y-3">
              {ancestors.map((parent) => (
                <AncestorMessage key={parent.id} message={parent} onOpenThread={onOpenThread} onChannelClick={onChannelClick} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Root Message (the message this thread branches from) */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-xs font-medium px-2 py-0.5 rounded"
            style={{ background: "var(--accent-glow)", color: "var(--accent-primary)" }}
          >
            Thread started from
          </span>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
            <Spinner size="sm" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : rootMessage ? (
          <RootMessageDisplay message={rootMessage} onOpenThread={onOpenThread} onChannelClick={onChannelClick} />
        ) : null}
      </div>
    </div>
  )
}

interface AncestorMessageProps {
  message: Message
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
  onChannelClick?: (channelSlug: string) => void
}

function AncestorMessage({ message, onOpenThread, onChannelClick }: AncestorMessageProps) {
  return (
    <div className="flex gap-3 pl-3 opacity-60" style={{ borderLeft: "2px solid var(--border-default)" }}>
      <div className="flex-1">
        <div className="flex items-baseline justify-between mb-0.5">
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            {message.email}
          </span>
          <RelativeTime date={message.timestamp} className="text-xs" style={{ color: "var(--text-muted)" }} />
        </div>
        <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
          <MessageContent content={message.message} mentions={message.mentions} onChannelClick={onChannelClick} />
        </div>
        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={(e) => onOpenThread?.(message.id, message.channelId, getOpenMode(e))}
            className="text-xs hover:underline"
            style={{ color: "var(--accent-primary)" }}
            title="Click to open, ⌥+click to open to side, ⌘+click for new tab"
          >
            View thread
          </button>
          <button
            onClick={() => onOpenThread?.(message.id, message.channelId, "side")}
            className="p-0.5 rounded hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
            title="Open thread to side"
          >
            <PanelRightOpen className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

interface RootMessageDisplayProps {
  message: Message
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
  onChannelClick?: (channelSlug: string) => void
}

function RootMessageDisplay({ message, onOpenThread, onChannelClick }: RootMessageDisplayProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Avatar name={message.email} size="sm" />
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {message.email}
        </span>
        <RelativeTime date={message.timestamp} className="text-xs" style={{ color: "var(--text-muted)" }} />
      </div>
      <div className="pl-8 text-sm" style={{ color: "var(--text-primary)" }}>
        <MessageContent content={message.message} mentions={message.mentions} onChannelClick={onChannelClick} />
      </div>
      {/* Allow branching from root message too */}
      <div className="pl-8 mt-1 opacity-0 hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => onOpenThread?.(message.id, message.channelId, getOpenMode(e))}
          className="text-xs hover:underline"
          style={{ color: "var(--accent-primary)" }}
          title="Click to open, ⌥+click to open to side, ⌘+click for new tab"
        >
          View thread
        </button>
      </div>
    </div>
  )
}
