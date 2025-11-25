import { useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { ChevronRight, ChevronDown, PanelRightOpen } from "lucide-react"
import { Avatar, Spinner } from "../ui"
import type { Message, OpenMode } from "../../types"
import { getOpenMode } from "../../types"

interface ThreadContextProps {
  rootMessage: Message | null
  ancestors: Message[]
  isLoading: boolean
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
}

export function ThreadContext({ rootMessage, ancestors, isLoading, onOpenThread }: ThreadContextProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)" }}>
      {/* Collapsible Ancestors */}
      {ancestors.length > 0 && (
        <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 w-full px-4 py-2 text-xs transition-colors hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {isExpanded ? "Hide context" : `Show ${ancestors.length} parent messages`}
          </button>

          {isExpanded && (
            <div className="px-4 pb-3 space-y-3">
              {ancestors.map((parent) => (
                <AncestorMessage key={parent.id} message={parent} onOpenThread={onOpenThread} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Root Message */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-xs font-medium px-2 py-0.5 rounded"
            style={{ background: "var(--accent-glow)", color: "var(--accent-primary)" }}
          >
            Parent
          </span>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
            <Spinner size="sm" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : rootMessage ? (
          <RootMessageDisplay message={rootMessage} />
        ) : null}
      </div>
    </div>
  )
}

interface AncestorMessageProps {
  message: Message
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
}

function AncestorMessage({ message, onOpenThread }: AncestorMessageProps) {
  return (
    <div className="flex gap-3 pl-3 opacity-60" style={{ borderLeft: "2px solid var(--border-default)" }}>
      <div className="flex-1">
        <div className="flex items-baseline justify-between mb-0.5">
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            {message.email}
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })}
          </span>
        </div>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {message.message}
        </p>
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
}

function RootMessageDisplay({ message }: RootMessageDisplayProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Avatar name={message.email} size="sm" />
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {message.email}
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })}
        </span>
      </div>
      <p className="pl-8 text-sm" style={{ color: "var(--text-primary)" }}>
        {message.message}
      </p>
    </div>
  )
}

