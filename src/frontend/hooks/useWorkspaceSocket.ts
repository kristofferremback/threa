import { useEffect, useRef, useState } from "react"
import { io, Socket } from "socket.io-client"
import { toast } from "sonner"
import type { Stream } from "../types"

interface UseWorkspaceSocketOptions {
  enabled?: boolean
  workspaceId?: string
  activeStreamSlug?: string
  currentUserId?: string
  onStreamAdded?: (stream: Stream) => void
  onStreamRemoved?: (streamId: string) => void
  onUnreadCountUpdate?: (streamId: string, increment: number) => void
  onNewNotification?: () => void
}

export function useWorkspaceSocket({
  enabled = true,
  workspaceId,
  activeStreamSlug,
  currentUserId,
  onStreamAdded,
  onStreamRemoved,
  onUnreadCountUpdate,
  onNewNotification,
}: UseWorkspaceSocketOptions) {
  const [socket, setSocket] = useState<Socket | null>(null)
  const activeStreamSlugRef = useRef(activeStreamSlug)
  const currentUserIdRef = useRef(currentUserId)

  // Use refs for callbacks to avoid reconnecting when they change
  const onStreamAddedRef = useRef(onStreamAdded)
  const onStreamRemovedRef = useRef(onStreamRemoved)
  const onUnreadCountUpdateRef = useRef(onUnreadCountUpdate)
  const onNewNotificationRef = useRef(onNewNotification)

  // Keep refs in sync
  useEffect(() => {
    activeStreamSlugRef.current = activeStreamSlug
  }, [activeStreamSlug])

  useEffect(() => {
    currentUserIdRef.current = currentUserId
  }, [currentUserId])

  useEffect(() => {
    onStreamAddedRef.current = onStreamAdded
  }, [onStreamAdded])

  useEffect(() => {
    onStreamRemovedRef.current = onStreamRemoved
  }, [onStreamRemoved])

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

    // Handle notification events (new events in streams)
    newSocket.on(
      "notification",
      (data: { type: string; streamId: string; streamSlug?: string; actorId?: string }) => {
        if (data.type === "event") {
          // Don't increment unread count for the user's own events
          if (data.actorId && data.actorId === currentUserIdRef.current) {
            return
          }

          // Don't increment unread count if we're currently viewing this stream
          const isActiveStream =
            activeStreamSlugRef.current === data.streamSlug || activeStreamSlugRef.current === data.streamId

          if (!isActiveStream) {
            onUnreadCountUpdateRef.current?.(data.streamId, 1)
          }
        }
      },
    )

    // Handle stream created (new channel visible)
    newSocket.on(
      "stream:created",
      (data: { id: string; streamType: string; name: string; slug: string; visibility: string; creatorId: string }) => {
        // Add the new stream to the list
        if (data.streamType === "channel" && data.visibility === "public") {
          const newStream: Stream = {
            id: data.id,
            workspaceId: workspaceId,
            streamType: data.streamType as any,
            name: data.name,
            slug: data.slug,
            description: null,
            topic: null,
            parentStreamId: null,
            branchedFromEventId: null,
            visibility: data.visibility as any,
            status: "active",
            isMember: data.creatorId === currentUserIdRef.current,
            unreadCount: 0,
            lastReadAt: null,
            notifyLevel: "default",
          }
          onStreamAddedRef.current?.(newStream)
        }
      },
    )

    // Handle being added to a stream
    newSocket.on(
      "stream:member:added",
      (data: { streamId: string; streamName: string; streamSlug: string; addedByUserId: string }) => {
        toast.success(`You were added to #${data.streamName.replace("#", "")}`)
        // Create a minimal stream object for the sidebar
        const newStream: Stream = {
          id: data.streamId,
          workspaceId: workspaceId,
          streamType: "channel",
          name: data.streamName,
          slug: data.streamSlug,
          description: null,
          topic: null,
          parentStreamId: null,
          branchedFromEventId: null,
          visibility: "private",
          status: "active",
          isMember: true,
          unreadCount: 0,
          lastReadAt: null,
          notifyLevel: "default",
        }
        onStreamAddedRef.current?.(newStream)
      },
    )

    // Handle being removed from a stream
    newSocket.on("stream:member:removed", (data: { streamId: string; streamName: string; removedByUserId?: string }) => {
      toast.error(`You were removed from #${data.streamName.replace("#", "")}`)
      onStreamRemovedRef.current?.(data.streamId)
    })

    // Handle new notifications (mentions, etc.)
    newSocket.on("notification:new", () => {
      onNewNotificationRef.current?.()
    })

    return () => {
      newSocket.disconnect()
      setSocket(null)
    }
  }, [enabled, workspaceId])

  return {
    socket,
  }
}
