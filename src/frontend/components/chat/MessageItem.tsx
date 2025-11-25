import { formatDistanceToNow } from "date-fns"
import { MessageCircle, PanelRightOpen } from "lucide-react"
import { Avatar } from "../ui"
import type { Message, OpenMode } from "../../types"
import { getOpenMode } from "../../types"

interface MessageItemProps {
  message: Message
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
  animationDelay?: number
  showThreadActions?: boolean
}

export function MessageItem({ message, onOpenThread, animationDelay = 0, showThreadActions = true }: MessageItemProps) {
  const hasReplies = message.replyCount && message.replyCount > 0

  return (
    <div
      className="group mb-1 rounded-lg p-3 -mx-2 transition-colors hover:bg-white/5 animate-fade-in"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      {/* Header */}
      <div className="mb-1 flex items-center gap-2">
        <Avatar name={message.email} size="sm" />
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {message.email}
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })}
        </span>
      </div>

      {/* Content */}
      <div className="pl-8 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {message.message}
      </div>

      {/* Thread actions */}
      {showThreadActions && (
        <div className="pl-8 mt-2">
          {hasReplies ? (
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => onOpenThread?.(message.id, message.channelId, getOpenMode(e))}
                className="text-xs flex items-center gap-1.5 transition-colors hover:underline"
                style={{ color: "var(--accent-primary)" }}
                title="Click to open, ⌥+click to open to side, ⌘+click for new tab"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span className="font-medium">
                  {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}
                </span>
              </button>
              <button
                onClick={() => onOpenThread?.(message.id, message.channelId, "side")}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/5"
                style={{ color: "var(--text-muted)" }}
                title="Open thread to side"
              >
                <PanelRightOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
              <button
                onClick={(e) => onOpenThread?.(message.id, message.channelId, getOpenMode(e))}
                className="text-xs flex items-center gap-1 transition-colors hover:underline"
                style={{ color: "var(--accent-primary)" }}
                title="Click to open, ⌥+click to open to side, ⌘+click for new tab"
              >
                <MessageCircle className="h-3 w-3" />
                Reply in thread
              </button>
              <button
                onClick={() => onOpenThread?.(message.id, message.channelId, "side")}
                className="p-1 rounded hover:bg-white/5"
                style={{ color: "var(--text-muted)" }}
                title="Open thread to side"
              >
                <PanelRightOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


