import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Avatar, RelativeTime } from "../ui"
import { MessageContent } from "./MessageContent"
import type { Message } from "../../types"
import { getDisplayName } from "../../types"

interface StickyThreadHeaderProps {
  rootMessage: Message
  isVisible: boolean
  onChannelClick?: (channelSlug: string, e: React.MouseEvent) => void
}

export function StickyThreadHeader({ rootMessage, isVisible, onChannelClick }: StickyThreadHeaderProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const displayName = getDisplayName(rootMessage.name, rootMessage.email)

  if (!isVisible) return null

  return (
    <div
      className="absolute top-0 left-0 right-0 z-10 transition-all duration-200"
      style={{
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border-subtle)",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
      }}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-white/5 transition-colors"
      >
        <Avatar name={displayName} size="xs" />
        <span className="text-sm font-medium truncate flex-1" style={{ color: "var(--text-primary)" }}>
          {displayName}
        </span>
        {!isExpanded && (
          <span className="text-xs truncate max-w-[200px]" style={{ color: "var(--text-muted)" }}>
            {rootMessage.message.slice(0, 60)}
            {rootMessage.message.length > 60 ? "..." : ""}
          </span>
        )}
        <RelativeTime
          date={rootMessage.timestamp}
          className="text-xs flex-shrink-0"
          style={{ color: "var(--text-muted)" }}
        />
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
        ) : (
          <ChevronDown className="h-4 w-4 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
        )}
      </button>

      {isExpanded && (
        <div className="px-4 pb-3">
          <div className="pl-7 text-sm" style={{ color: "var(--text-primary)" }}>
            <MessageContent
              content={rootMessage.message}
              mentions={rootMessage.mentions}
              onChannelClick={onChannelClick}
            />
          </div>
        </div>
      )}
    </div>
  )
}
