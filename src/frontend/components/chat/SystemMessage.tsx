import { UserPlus, LogIn } from "lucide-react"
import { RelativeTime } from "../ui"
import type { Message } from "../../types"

interface SystemMessageProps {
  message: Message
  animationDelay?: number
}

export function SystemMessage({ message, animationDelay = 0 }: SystemMessageProps) {
  const metadata = message.metadata
  if (!metadata) return null

  const renderContent = () => {
    const userName = metadata.userName || metadata.userEmail || "Someone"

    switch (metadata.event) {
      case "member_joined":
        return (
          <>
            <LogIn className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
            <span>
              <strong style={{ color: "var(--text-primary)" }}>{userName}</strong> joined the channel
            </span>
          </>
        )

      case "member_added": {
        const addedByName = metadata.addedByName || metadata.addedByEmail || "Someone"
        return (
          <>
            <UserPlus className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
            <span>
              <strong style={{ color: "var(--text-primary)" }}>{userName}</strong> was added by{" "}
              <strong style={{ color: "var(--text-primary)" }}>{addedByName}</strong>
            </span>
          </>
        )
      }

      case "member_removed":
        return (
          <>
            <UserPlus className="h-4 w-4" style={{ color: "var(--text-muted)" }} />
            <span>
              <strong style={{ color: "var(--text-primary)" }}>{userName}</strong> was removed from the channel
            </span>
          </>
        )

      default:
        return null
    }
  }

  const content = renderContent()
  if (!content) return null

  return (
    <div
      className="flex items-center justify-center gap-2 py-2 text-sm animate-fade-in"
      style={{ animationDelay: `${animationDelay}ms`, color: "var(--text-secondary)" }}
    >
      {content}
      <span style={{ color: "var(--text-muted)" }}>·</span>
      <RelativeTime date={message.timestamp} className="text-xs" style={{ color: "var(--text-muted)" }} />
    </div>
  )
}

