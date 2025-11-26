import { useEffect, useRef } from "react"
import { io, Socket } from "socket.io-client"
import { toast } from "sonner"
import type { Channel } from "../types"

interface UseWorkspaceSocketOptions {
  enabled?: boolean
  workspaceId?: string
  activeChannelSlug?: string
  onChannelAdded?: (channel: Channel) => void
  onChannelRemoved?: (channelId: string) => void
  onUnreadCountUpdate?: (channelId: string, increment: number) => void
}

export function useWorkspaceSocket({
  enabled = true,
  workspaceId,
  activeChannelSlug,
  onChannelAdded,
  onChannelRemoved,
  onUnreadCountUpdate,
}: UseWorkspaceSocketOptions) {
  const socketRef = useRef<Socket | null>(null)
  const activeChannelSlugRef = useRef(activeChannelSlug)

  // Keep ref in sync
  useEffect(() => {
    activeChannelSlugRef.current = activeChannelSlug
  }, [activeChannelSlug])

  useEffect(() => {
    if (!enabled || !workspaceId) {
      return
    }

    const socket = io({ withCredentials: true })
    socketRef.current = socket

    // Handle notification events (new messages in channels)
    socket.on(
      "notification",
      (data: { type: string; channelId: string; channelSlug?: string; conversationId?: string }) => {
        if (data.type === "message") {
          // Don't increment unread count if we're currently viewing this channel
          // Compare against both slug and ID since we track by slug but server may send ID
          const isActiveChannel =
            activeChannelSlugRef.current === data.channelSlug || activeChannelSlugRef.current === data.channelId

          if (!isActiveChannel) {
            onUnreadCountUpdate?.(data.channelId, 1)
          }
        }
      },
    )

    // Handle being added to a channel
    socket.on("channelMemberAdded", (data: { channel: Channel; addedByUserId: string; eventType: string }) => {
      const isJoining = data.eventType === "member_joined"
      if (!isJoining) {
        // Only show toast if someone else added us
        toast.success(`You were added to #${data.channel.name.replace("#", "")}`)
      }
      onChannelAdded?.(data.channel)
    })

    // Handle being removed from a channel
    socket.on("channelMemberRemoved", (data: { channelId: string; channelName: string; removedByUserId?: string }) => {
      toast.error(`You were removed from #${data.channelName.replace("#", "")}`)
      onChannelRemoved?.(data.channelId)
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [enabled, workspaceId, onChannelAdded, onChannelRemoved, onUnreadCountUpdate])

  return {
    socket: socketRef.current,
  }
}
