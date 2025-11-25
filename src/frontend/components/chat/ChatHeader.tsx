import { Hash, MessageCircle } from "lucide-react"
import { StatusIndicator } from "../ui"

interface ChatHeaderProps {
  title: string
  isThread?: boolean
  isConnected: boolean
}

export function ChatHeader({ title, isThread = false, isConnected }: ChatHeaderProps) {
  return (
    <div
      className="flex items-center justify-between px-4 py-3 flex-shrink-0"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
      <div className="flex items-center gap-3">
        {isThread ? (
          <MessageCircle className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
        ) : (
          <Hash className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
        )}
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {title}
          </h2>
          {isThread && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Thread
            </span>
          )}
        </div>
      </div>
      <StatusIndicator status={isConnected ? "online" : "offline"} />
    </div>
  )
}


