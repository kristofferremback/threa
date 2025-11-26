import { useState, useEffect, useCallback } from "react"
import { Bell, CheckCheck, AtSign, MessageCircle, Hash, UserPlus } from "lucide-react"
import { Avatar, RelativeTime, Spinner, Button } from "../ui"

interface Notification {
  id: string
  type: string
  messageId: string | null
  channelId: string | null
  channelName: string | null
  channelSlug: string | null
  conversationId: string | null
  actorId: string | null
  actorName: string | null
  actorEmail: string | null
  preview: string | null
  readAt: string | null
  createdAt: string
}

interface InboxViewProps {
  workspaceId: string
  onNavigateToChannel?: (channelSlug: string) => void
  onNavigateToThread?: (messageId: string, channelId: string) => void
}

export function InboxView({ workspaceId, onNavigateToChannel, onNavigateToThread }: InboxViewProps) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/notifications?limit=100`, {
        credentials: "include",
      })
      if (!res.ok) throw new Error("Failed to fetch notifications")
      const data = await res.json()
      setNotifications(data.notifications)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notifications")
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const handleMarkAllRead = async () => {
    try {
      await fetch(`/api/workspace/${workspaceId}/notifications/read-all`, {
        method: "POST",
        credentials: "include",
      })
      setNotifications((prev) =>
        prev.map((n) => ({
          ...n,
          readAt: n.readAt || new Date().toISOString(),
        })),
      )
    } catch (err) {
      console.error("Failed to mark all as read:", err)
    }
  }

  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read
    if (!notification.readAt) {
      try {
        await fetch(`/api/workspace/${workspaceId}/notifications/${notification.id}/read`, {
          method: "POST",
          credentials: "include",
        })
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n,
          ),
        )
      } catch (err) {
        console.error("Failed to mark notification as read:", err)
      }
    }

    // Navigate to the relevant location
    if (notification.conversationId && notification.messageId && notification.channelId) {
      onNavigateToThread?.(notification.messageId, notification.channelId)
    } else if (notification.channelSlug) {
      onNavigateToChannel?.(notification.channelSlug)
    }
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "mention":
        return <AtSign className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
      case "thread_reply":
        return <MessageCircle className="h-4 w-4" style={{ color: "var(--text-muted)" }} />
      case "channel_join":
        return <UserPlus className="h-4 w-4" style={{ color: "var(--success)" }} />
      default:
        return <Bell className="h-4 w-4" style={{ color: "var(--text-muted)" }} />
    }
  }

  const getNotificationText = (notification: Notification) => {
    switch (notification.type) {
      case "mention":
        return (
          <>
            <strong>{notification.actorName || notification.actorEmail}</strong> mentioned you
            {notification.channelName && (
              <>
                {" in "}
                <span style={{ color: "var(--accent-primary)" }}>#{notification.channelName}</span>
              </>
            )}
          </>
        )
      case "thread_reply":
        return (
          <>
            <strong>{notification.actorName || notification.actorEmail}</strong> replied to a thread you're following
          </>
        )
      case "channel_join":
        return (
          <>
            You were added to <span style={{ color: "var(--accent-primary)" }}>#{notification.channelName}</span>
          </>
        )
      default:
        return "New notification"
    }
  }

  const unreadCount = notifications.filter((n) => !n.readAt).length

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p style={{ color: "var(--text-muted)" }}>{error}</p>
          <Button variant="ghost" onClick={fetchNotifications} className="mt-2">
            Try again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--bg-primary)" }}>
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5" style={{ color: "var(--text-primary)" }} />
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            Activity
          </h2>
          {unreadCount > 0 && (
            <span
              className="px-2 py-0.5 text-xs font-medium rounded-full"
              style={{ background: "var(--accent-primary)", color: "white" }}
            >
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMarkAllRead}
            icon={<CheckCheck className="h-4 w-4" />}
          >
            Mark all read
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Bell className="h-12 w-12 mx-auto mb-4 opacity-30" style={{ color: "var(--text-muted)" }} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No notifications yet
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                You'll see @mentions and thread replies here
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
            {notifications.map((notification) => (
              <button
                key={notification.id}
                onClick={() => handleNotificationClick(notification)}
                className="w-full px-4 py-3 text-left transition-colors hover:bg-[var(--hover-overlay)] flex gap-3"
                style={{
                  background: notification.readAt ? "transparent" : "var(--unread-bg, rgba(99, 102, 241, 0.05))",
                }}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {notification.actorEmail ? (
                    <Avatar name={notification.actorEmail} size="sm" />
                  ) : (
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center"
                      style={{ background: "var(--bg-tertiary)" }}
                    >
                      {getNotificationIcon(notification.type)}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                      {getNotificationText(notification)}
                    </p>
                    <RelativeTime
                      date={notification.createdAt}
                      className="text-xs flex-shrink-0"
                      style={{ color: "var(--text-muted)" }}
                    />
                  </div>

                  {notification.preview && (
                    <p
                      className="text-sm mt-1 truncate"
                      style={{ color: "var(--text-muted)" }}
                    >
                      "{notification.preview}"
                    </p>
                  )}

                  {notification.channelSlug && (
                    <div className="flex items-center gap-1 mt-1">
                      <Hash className="h-3 w-3" style={{ color: "var(--text-muted)" }} />
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {notification.channelSlug}
                      </span>
                    </div>
                  )}
                </div>

                {!notification.readAt && (
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0 mt-2"
                    style={{ background: "var(--accent-primary)" }}
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

