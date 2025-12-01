import { useEffect, useRef, useState } from "react"
import { io, Socket } from "socket.io-client"
import { toast } from "sonner"
import type { Stream, BootstrapUser } from "../types"

interface UseWorkspaceSocketOptions {
  enabled?: boolean
  workspaceId?: string
  activeStreamSlug?: string
  currentUserId?: string
  onStreamAdded?: (stream: Stream) => void
  onStreamUpdated?: (streamId: string, updates: Partial<Stream>) => void
  onStreamRemoved?: (streamId: string) => void
  onUnreadCountUpdate?: (streamId: string, increment: number) => void
  onNewNotification?: () => void
  onUserAdded?: (user: BootstrapUser) => void
  onUserUpdated?: (userId: string, updates: Partial<BootstrapUser>) => void
  onUserRemoved?: (userId: string) => void
  onInvitationCreated?: (invitation: { id: string; email: string; role: string }) => void
  onInvitationAccepted?: (data: { userId: string; userEmail: string; userName?: string }) => void
  onInvitationRevoked?: (invitationId: string) => void
}

export function useWorkspaceSocket({
  enabled = true,
  workspaceId,
  activeStreamSlug,
  currentUserId,
  onStreamAdded,
  onStreamUpdated,
  onStreamRemoved,
  onUnreadCountUpdate,
  onNewNotification,
  onUserAdded,
  onUserUpdated,
  onUserRemoved,
  onInvitationCreated,
  onInvitationAccepted,
  onInvitationRevoked,
}: UseWorkspaceSocketOptions) {
  const [socket, setSocket] = useState<Socket | null>(null)
  const activeStreamSlugRef = useRef(activeStreamSlug)
  const currentUserIdRef = useRef(currentUserId)

  // Use refs for callbacks to avoid reconnecting when they change
  const onStreamAddedRef = useRef(onStreamAdded)
  const onStreamUpdatedRef = useRef(onStreamUpdated)
  const onStreamRemovedRef = useRef(onStreamRemoved)
  const onUnreadCountUpdateRef = useRef(onUnreadCountUpdate)
  const onNewNotificationRef = useRef(onNewNotification)
  const onUserAddedRef = useRef(onUserAdded)
  const onUserUpdatedRef = useRef(onUserUpdated)
  const onUserRemovedRef = useRef(onUserRemoved)
  const onInvitationCreatedRef = useRef(onInvitationCreated)
  const onInvitationAcceptedRef = useRef(onInvitationAccepted)
  const onInvitationRevokedRef = useRef(onInvitationRevoked)

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
    onStreamUpdatedRef.current = onStreamUpdated
  }, [onStreamUpdated])

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
    onUserAddedRef.current = onUserAdded
  }, [onUserAdded])

  useEffect(() => {
    onUserUpdatedRef.current = onUserUpdated
  }, [onUserUpdated])

  useEffect(() => {
    onUserRemovedRef.current = onUserRemoved
  }, [onUserRemoved])

  useEffect(() => {
    onInvitationCreatedRef.current = onInvitationCreated
  }, [onInvitationCreated])

  useEffect(() => {
    onInvitationAcceptedRef.current = onInvitationAccepted
  }, [onInvitationAccepted])

  useEffect(() => {
    onInvitationRevokedRef.current = onInvitationRevoked
  }, [onInvitationRevoked])

  useEffect(() => {
    if (!enabled || !workspaceId) {
      return
    }

    const newSocket = io({ withCredentials: true })
    setSocket(newSocket)

    // Handle notification events (new events in streams)
    newSocket.on("notification", (data: { type: string; streamId: string; streamSlug?: string; actorId?: string }) => {
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
    })

    // Handle stream created (new channel visible)
    newSocket.on(
      "stream:created",
      (data: { id: string; streamType: string; name: string; slug: string; visibility: string; creatorId: string }) => {
        // Add the new stream to the list
        if (data.streamType === "channel" && data.visibility === "public") {
          const newStream: Stream = {
            id: data.id,
            workspaceId: workspaceId!,
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
            pinnedAt: null,
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
          workspaceId: workspaceId!,
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
          pinnedAt: null,
        }
        onStreamAddedRef.current?.(newStream)
      },
    )

    // Handle being removed from a stream
    newSocket.on(
      "stream:member:removed",
      (data: { streamId: string; streamName: string; removedByUserId?: string }) => {
        toast.error(`You were removed from #${data.streamName.replace("#", "")}`)
        onStreamRemovedRef.current?.(data.streamId)
      },
    )

    // Handle new notifications (mentions, etc.)
    newSocket.on("notification:new", () => {
      onNewNotificationRef.current?.()
    })

    // Handle stream updates (name, description, topic changes)
    newSocket.on(
      "stream:updated",
      (data: { id: string; name?: string; slug?: string; description?: string; topic?: string }) => {
        onStreamUpdatedRef.current?.(data.id, {
          name: data.name,
          slug: data.slug,
          description: data.description,
          topic: data.topic,
        })
      },
    )

    // Handle stream archived/unarchived
    newSocket.on("stream:archived", (data: { id: string; archived: boolean }) => {
      if (data.archived) {
        onStreamRemovedRef.current?.(data.id)
        toast.info("Channel has been archived")
      }
    })

    // Handle workspace member added
    newSocket.on(
      "workspace:member:added",
      (data: { userId: string; userEmail: string; userName?: string; role: string }) => {
        const displayName = data.userName ?? data.userEmail.split("@")[0] ?? "Unknown"
        const newUser: BootstrapUser = {
          id: data.userId,
          email: data.userEmail,
          name: displayName,
          title: null,
          avatarUrl: null,
          role: data.role as "admin" | "member" | "guest",
        }
        onUserAddedRef.current?.(newUser)
        toast.success(`${displayName} joined the workspace`)
      },
    )

    // Handle workspace member removed
    newSocket.on("workspace:member:removed", (data: { userId: string; userEmail: string }) => {
      onUserRemovedRef.current?.(data.userId)
    })

    // Handle workspace member updated (role change, etc.)
    newSocket.on("workspace:member:updated", (data: { userId: string; role?: string; status?: string }) => {
      if (data.role) {
        onUserUpdatedRef.current?.(data.userId, { role: data.role as "admin" | "member" | "guest" })
      }
    })

    // Handle user profile updated
    newSocket.on(
      "user:profile:updated",
      (data: { userId: string; displayName?: string; title?: string; avatarUrl?: string }) => {
        onUserUpdatedRef.current?.(data.userId, {
          name: data.displayName || undefined,
          title: data.title,
          avatarUrl: data.avatarUrl,
        })
      },
    )

    // Handle invitation created
    newSocket.on("invitation:created", (data: { id: string; email: string; role: string; invitedByEmail: string }) => {
      onInvitationCreatedRef.current?.({ id: data.id, email: data.email, role: data.role })
    })

    // Handle invitation accepted (new member joined via invite)
    newSocket.on(
      "invitation:accepted",
      (data: { id: string; userId: string; userEmail: string; userName?: string; role: string }) => {
        onInvitationAcceptedRef.current?.({
          userId: data.userId,
          userEmail: data.userEmail,
          userName: data.userName,
        })
      },
    )

    // Handle invitation revoked
    newSocket.on("invitation:revoked", (data: { id: string; email: string }) => {
      onInvitationRevokedRef.current?.(data.id)
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
