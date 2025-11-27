import { useState, useEffect, useCallback } from "react"
import { Bell, CheckCheck, AtSign, MessageCircle, Hash, UserPlus, PanelRightOpen } from "lucide-react"
import { Avatar, RelativeTime, Spinner, Button } from "../ui"
import { getOpenMode, type OpenMode } from "../../types"
import type { Socket } from "socket.io-client"

interface Notification {
  id: string
  notificationType: string
  streamId: string | null
  streamName: string | null
  streamSlug: string | null
  streamType: string | null
  eventId: string | null
  actorId: string | null
  actorName: string | null
  actorEmail: string | null
  preview?: string | null
  readAt: string | null
  createdAt: string
}

type TabType = "unread" | "all"

// Helper to safely extract slug string (handles legacy corrupted data)
function getSlugString(slug: string | null | undefined | { slug?: string }): string | null {
  if (!slug) return null
  if (typeof slug === "string") {
    // Check if it's a JSON string
    if (slug.startsWith("{")) {
      try {
        const parsed = JSON.parse(slug)
        return parsed.slug || null
      } catch {
        return slug
      }
    }
    return slug
  }
  // It's an object
  if (typeof slug === "object" && "slug" in slug) {
    return slug.slug || null
  }
  return null
}

interface InboxViewProps {
  workspaceId: string
  socket?: Socket | null
  onNavigateToStream?: (streamSlug: string, mode?: OpenMode, highlightEventId?: string) => void
  onUnreadCountChange?: (count: number) => void
}

export function InboxView({
  workspaceId,
  socket,
  onNavigateToStream,
  onUnreadCountChange,
}: InboxViewProps) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>("unread")

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

  // Listen for real-time notifications
  useEffect(() => {
    if (!socket) return

    const handleNewNotification = (notification: Notification) => {
      setNotifications((prev) => {
        // Check if notification already exists
        if (prev.some((n) => n.id === notification.id)) {
          return prev
        }
        // Add new notification at the top
        const updated = [notification, ...prev]
        // Notify parent of new unread count
        const newUnreadCount = updated.filter((n) => !n.readAt).length
        onUnreadCountChange?.(newUnreadCount)
        return updated
      })
    }

    socket.on("notification:new", handleNewNotification)

    return () => {
      socket.off("notification:new", handleNewNotification)
    }
  }, [socket, onUnreadCountChange])

  // Notify parent when unread count changes
  const unreadCount = notifications.filter((n) => !n.readAt).length
  useEffect(() => {
    onUnreadCountChange?.(unreadCount)
  }, [unreadCount, onUnreadCountChange])

  const handleMarkAllRead = async () => {
    try {
      await fetch(`/api/workspace/${workspaceId}/notifications/read-all`, {
        method: "POST",
        credentials: "include",
      })
      setNotifications((prev) => {
        const updated = prev.map((n) => ({
          ...n,
          readAt: n.readAt || new Date().toISOString(),
        }))
        // Immediately notify parent of new count (0 since all are read)
        onUnreadCountChange?.(0)
        return updated
      })
    } catch (err) {
      console.error("Failed to mark all as read:", err)
    }
  }

  const handleNotificationClick = async (notification: Notification, e: React.MouseEvent) => {
    const mode = getOpenMode(e)

    // Mark as read (optimistically update UI first)
    if (!notification.readAt) {
      // Optimistic update - update state immediately
      setNotifications((prev) => {
        const updated = prev.map((n) =>
          n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n,
        )
        // Immediately notify parent of new count
        const newUnreadCount = updated.filter((n) => !n.readAt).length
        onUnreadCountChange?.(newUnreadCount)
        return updated
      })

      // Then persist to server (fire and forget)
      fetch(`/api/workspace/${workspaceId}/notifications/${notification.id}/read`, {
        method: "POST",
        credentials: "include",
      }).catch((err) => console.error("Failed to mark notification as read:", err))
    }

    // Navigate to the relevant stream
    const slug = getSlugString(notification.streamSlug)
    if (slug) {
      onNavigateToStream?.(slug, mode, notification.eventId || undefined)
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
    const streamName = getSlugString(notification.streamName) || getSlugString(notification.streamSlug)

    switch (notification.notificationType) {
      case "mention":
        return (
          <>
            <strong>{notification.actorName || notification.actorEmail}</strong> mentioned you
            {streamName && (
              <>
                {" in "}
                <span style={{ color: "var(--accent-primary)" }}>#{streamName}</span>
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
            You were added to <span style={{ color: "var(--accent-primary)" }}>#{streamName}</span>
          </>
        )
      default:
        return "New notification"
    }
  }

  // Filter notifications based on active tab
  const filteredNotifications =
    activeTab === "unread" ? notifications.filter((n) => !n.readAt) : notifications

  const readCount = notifications.filter((n) => n.readAt).length

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
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--bg-primary)" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5" style={{ color: "var(--text-primary)" }} />
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            Activity
          </h2>
        </div>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" onClick={handleMarkAllRead} icon={<CheckCheck className="h-4 w-4" />}>
            Mark all read
          </Button>
        )}
      </div>

      {/* Sub-tabs */}
      <div
        className="flex items-center gap-1 px-4 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <button
          onClick={() => setActiveTab("unread")}
          className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
          style={{
            background: activeTab === "unread" ? "var(--accent-primary)" : "transparent",
            color: activeTab === "unread" ? "white" : "var(--text-muted)",
          }}
        >
          Unread
          {unreadCount > 0 && (
            <span
              className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full"
              style={{
                background: activeTab === "unread" ? "rgba(255,255,255,0.2)" : "var(--accent-primary)",
                color: activeTab === "unread" ? "white" : "white",
              }}
            >
              {unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("all")}
          className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
          style={{
            background: activeTab === "all" ? "var(--bg-tertiary)" : "transparent",
            color: activeTab === "all" ? "var(--text-primary)" : "var(--text-muted)",
          }}
        >
          All
          {readCount > 0 && (
            <span
              className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full"
              style={{
                background: "var(--bg-secondary)",
                color: "var(--text-muted)",
              }}
            >
              {notifications.length}
            </span>
          )}
        </button>
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto">
        {filteredNotifications.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Bell className="h-12 w-12 mx-auto mb-4 opacity-30" style={{ color: "var(--text-muted)" }} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {activeTab === "unread" ? "All caught up!" : "No notifications yet"}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {activeTab === "unread"
                  ? "You have no unread notifications"
                  : "You'll see @mentions and thread replies here"}
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
            {filteredNotifications.map((notification) => (
              <div
                key={notification.id}
                role="button"
                tabIndex={0}
                onClick={(e) => handleNotificationClick(notification, e)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    handleNotificationClick(notification, e as unknown as React.MouseEvent)
                  }
                }}
                className="group w-full px-4 py-3 text-left transition-colors hover:bg-[var(--hover-overlay)] flex gap-3 cursor-pointer"
                style={{
                  background: notification.readAt ? "transparent" : "var(--unread-bg, rgba(99, 102, 241, 0.05))",
                }}
                title="Click to open, ⌥+click to open to side, ⌘+click for new tab"
              >
                <div className="flex-shrink-0 mt-0.5">
                  {notification.actorEmail ? (
                    <Avatar name={notification.actorEmail} size="sm" />
                  ) : (
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center"
                      style={{ background: "var(--bg-tertiary)" }}
                    >
                      {getNotificationIcon(notification.notificationType)}
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
                    <p className="text-sm mt-1 truncate" style={{ color: "var(--text-muted)" }}>
                      "{notification.preview}"
                    </p>
                  )}

                  {getSlugString(notification.streamSlug) && (
                    <div className="flex items-center gap-1 mt-1">
                      <Hash className="h-3 w-3" style={{ color: "var(--text-muted)" }} />
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {getSlugString(notification.streamSlug)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {!notification.readAt && (
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ background: "var(--accent-primary)" }}
                    />
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleNotificationClick(notification, { ...e, altKey: true } as React.MouseEvent)
                    }}
                    className="p-1 rounded hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: "var(--text-muted)" }}
                    title="Open to side"
                  >
                    <PanelRightOpen className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
