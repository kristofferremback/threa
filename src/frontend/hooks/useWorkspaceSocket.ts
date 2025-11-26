import { useEffect, useRef, useState } from "react"
import { io, Socket } from "socket.io-client"
import { toast } from "sonner"
import type { Channel } from "../types"

interface UseWorkspaceSocketOptions {
  enabled?: boolean
  workspaceId?: string
  activeChannelSlug?: string
  currentUserId?: string
  onChannelAdded?: (channel: Channel) => void
  onChannelRemoved?: (channelId: string) => void
  onUnreadCountUpdate?: (channelId: string, increment: number) => void
  onNewNotification?: () => void
}

export function useWorkspaceSocket({
  enabled = true,
  workspaceId,
  activeChannelSlug,
  currentUserId,
  onChannelAdded,
  onChannelRemoved,
  onUnreadCountUpdate,
  onNewNotification,
}: UseWorkspaceSocketOptions) {
  const [socket, setSocket] = useState<Socket | null>(null)
  const activeChannelSlugRef = useRef(activeChannelSlug)
  const currentUserIdRef = useRef(currentUserId)
  
  // Use refs for callbacks to avoid reconnecting when they change
  const onChannelAddedRef = useRef(onChannelAdded)
  const onChannelRemovedRef = useRef(onChannelRemoved)
  const onUnreadCountUpdateRef = useRef(onUnreadCountUpdate)
  const onNewNotificationRef = useRef(onNewNotification)

  // Keep refs in sync
  useEffect(() => {
    activeChannelSlugRef.current = activeChannelSlug
  }, [activeChannelSlug])

  useEffect(() => {
    currentUserIdRef.current = currentUserId
  }, [currentUserId])
  
  useEffect(() => {
    onChannelAddedRef.current = onChannelAdded
  }, [onChannelAdded])
  
  useEffect(() => {
    onChannelRemovedRef.current = onChannelRemoved
  }, [onChannelRemoved])
  
  useEffect(() => {
    onUnreadCountUpdateRef.current = onUnreadCountUpdate
  }, [onUnreadCountUpdate])
  
  useEffect(() => {
    onNewNotificationRef.current = onNewNotification
  }, [onNewNotification])

  useEffect(() => {
    if (!enabled || !workspaceId) {
      return
    }

    const newSocket = io({ withCredentials: true })
    setSocket(newSocket)

    // Handle notification events (new messages in channels)
    newSocket.on(
      "notification",
      (data: { type: string; channelId: string; channelSlug?: string; conversationId?: string; authorId?: string }) => {
        if (data.type === "message") {
          // Don't increment unread count for the user's own messages
          if (data.authorId && data.authorId === currentUserIdRef.current) {
            return
          }

          // Don't increment unread count if we're currently viewing this channel
          // Compare against both slug and ID since we track by slug but server may send ID
          const isActiveChannel =
            activeChannelSlugRef.current === data.channelSlug || activeChannelSlugRef.current === data.channelId

          if (!isActiveChannel) {
            onUnreadCountUpdateRef.current?.(data.channelId, 1)
          }
        }
      },
    )

    // Handle being added to a channel
    newSocket.on("channelMemberAdded", (data: { channel: Channel; addedByUserId: string; eventType: string }) => {
      const isJoining = data.eventType === "member_joined"
      if (!isJoining) {
        // Only show toast if someone else added us
        toast.success(`You were added to #${data.channel.name.replace("#", "")}`)
      }
      onChannelAddedRef.current?.(data.channel)
    })

    // Handle being removed from a channel
    newSocket.on("channelMemberRemoved", (data: { channelId: string; channelName: string; removedByUserId?: string }) => {
      toast.error(`You were removed from #${data.channelName.replace("#", "")}`)
      onChannelRemovedRef.current?.(data.channelId)
    })

    // Handle new notifications (mentions, etc.)
    newSocket.on("notification:new", () => {
      onNewNotificationRef.current?.()
    })

    return () => {
      newSocket.disconnect()
      setSocket(null)
    }
  }, [enabled, workspaceId]) // Only reconnect when enabled or workspaceId changes

  return {
    socket,
  }
}
