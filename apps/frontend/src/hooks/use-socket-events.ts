import { useEffect, useMemo, useRef } from "react"
import { useQueryClient, useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { useSocket, useSocketReconnectCount } from "@/contexts"
import { useAuth } from "@/auth"
import { debugBootstrap } from "@/lib/bootstrap-debug"
import { db } from "@/db"
import { joinRoomFireAndForget } from "@/lib/socket-room"
import { streamKeys } from "./use-streams"
import { workspaceKeys } from "./use-workspaces"
import type {
  Stream,
  User,
  WorkspaceMember,
  WorkspaceBootstrap,
  StreamMember,
  UserPreferences,
  LastMessagePreview,
  ActivityCreatedPayload,
} from "@threa/types"

/** Member shape from MemberRepository (includes name/email from users JOIN) */
interface MemberWithDisplay {
  id: string
  workspaceId: string
  userId: string
  role: string
  slug: string
  name: string
  description: string | null
  avatarUrl: string | null
  avatarStatus: string | null
  timezone: string | null
  locale: string | null
  setupCompleted: boolean
  email: string
  joinedAt: string
}

interface StreamPayload {
  workspaceId: string
  streamId: string
  stream: Stream
}

interface WorkspaceMemberAddedPayload {
  workspaceId: string
  member: MemberWithDisplay
}

interface WorkspaceMemberRemovedPayload {
  workspaceId: string
  memberId: string
}

interface MemberUpdatedPayload {
  workspaceId: string
  member: MemberWithDisplay
}

interface StreamReadPayload {
  workspaceId: string
  authorId: string
  streamId: string
  lastReadEventId: string
}

interface StreamsReadAllPayload {
  workspaceId: string
  authorId: string
  streamIds: string[]
}

interface StreamActivityPayload {
  workspaceId: string
  streamId: string
  authorId: string
  lastMessagePreview: LastMessagePreview
}

interface StreamDisplayNameUpdatedPayload {
  workspaceId: string
  streamId: string
  displayName: string
}

interface UserPreferencesUpdatedPayload {
  workspaceId: string
  authorId: string
  preferences: UserPreferences
}

/**
 * Hook to handle Socket.io events for stream updates.
 * Joins the workspace room and listens for stream:created/updated/archived events.
 * Updates React Query cache and IndexedDB when events are received.
 */
export function useSocketEvents(workspaceId: string) {
  const queryClient = useQueryClient()
  const socket = useSocket()
  const reconnectCount = useSocketReconnectCount()
  const { user } = useAuth()
  const { streamId: currentStreamId } = useParams<{ streamId: string }>()

  // Use ref to avoid stale closure in socket handlers
  const currentStreamIdRef = useRef(currentStreamId)
  currentStreamIdRef.current = currentStreamId

  // Subscribe to stream memberships so we can join/leave stream rooms reactively
  const { data: memberStreamIds } = useQuery({
    queryKey: workspaceKeys.bootstrap(workspaceId),
    // Cache-only observer: we subscribe to bootstrap cache updates without triggering fetches.
    // queryFn must still be present because this observer shares the bootstrap query key.
    queryFn: () => queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId)) ?? null,
    select: (data: WorkspaceBootstrap | null) => data?.streamMemberships?.map((m: StreamMember) => m.streamId) ?? [],
    enabled: false,
  })

  debugBootstrap("Socket events cache observer state", {
    workspaceId,
    hasSocket: !!socket,
    memberStreamIds,
  })

  // Stable serialization for dependency tracking
  const memberStreamIdsKey = useMemo(() => (memberStreamIds ?? []).sort().join(","), [memberStreamIds])

  // Join all member stream rooms so stream-scoped events (e.g. stream:activity)
  // are received for every stream the user belongs to, not just the active one.
  useEffect(() => {
    if (!socket || !workspaceId || !memberStreamIdsKey) return

    const abortController = new AbortController()
    const ids = memberStreamIdsKey.split(",").filter(Boolean)
    debugBootstrap("Socket events joining member stream rooms", { workspaceId, streamIds: ids })
    for (const id of ids) {
      joinRoomFireAndForget(socket, `ws:${workspaceId}:stream:${id}`, abortController.signal, "SocketEvents")
    }

    return () => {
      abortController.abort()
      for (const id of ids) {
        socket.emit("leave", `ws:${workspaceId}:stream:${id}`)
      }
    }
  }, [socket, workspaceId, memberStreamIdsKey, reconnectCount])

  useEffect(() => {
    if (!socket || !workspaceId) return

    const abortController = new AbortController()

    // Join workspace room to receive stream metadata events
    debugBootstrap("Socket events joining workspace room", { workspaceId })
    joinRoomFireAndForget(socket, `ws:${workspaceId}`, abortController.signal, "SocketEvents")

    // Handle stream created
    socket.on("stream:created", (payload: StreamPayload) => {
      let shouldJoinStreamRoom = false

      // Add to workspace bootstrap cache (sidebar)
      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old

        const streamExists = old.streams.some((s) => s.id === payload.stream.id)
        const currentMember = user && old.members?.find((m: WorkspaceMember) => m.userId === user.id)
        const isCreator = Boolean(currentMember && payload.stream.createdBy === currentMember.id)
        const hasMembership = old.streamMemberships.some((m: StreamMember) => m.streamId === payload.stream.id)
        const shouldAddMembership = isCreator && !hasMembership

        // Ensure creators are subscribed immediately for follow-up stream activity
        // (prevents missing early stream:activity events after channel creation).
        shouldJoinStreamRoom = hasMembership || shouldAddMembership

        if (streamExists && !shouldAddMembership) return old

        return {
          ...old,
          streams: streamExists ? old.streams : [...old.streams, { ...payload.stream, lastMessagePreview: null }],
          streamMemberships: shouldAddMembership
            ? [
                ...old.streamMemberships,
                {
                  streamId: payload.stream.id,
                  memberId: payload.stream.createdBy,
                  pinned: false,
                  pinnedAt: null,
                  notificationLevel: null,
                  lastReadEventId: null,
                  lastReadAt: null,
                  joinedAt: payload.stream.createdAt,
                },
              ]
            : old.streamMemberships,
        }
      })

      if (shouldJoinStreamRoom) {
        joinRoomFireAndForget(
          socket,
          `ws:${workspaceId}:stream:${payload.stream.id}`,
          abortController.signal,
          "SocketEvents"
        )
      }

      // Cache to IndexedDB
      db.streams.put({ ...payload.stream, _cachedAt: Date.now() })
    })

    // Handle stream updated
    socket.on("stream:updated", (payload: StreamPayload) => {
      // Update stream detail cache
      queryClient.setQueryData(streamKeys.detail(workspaceId, payload.stream.id), payload.stream)

      // Update stream bootstrap cache (preserves events, members, etc.)
      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, payload.stream.id), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        return { ...old, stream: payload.stream }
      })

      // Update workspace bootstrap cache (sidebar) - handle visibility changes
      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old?.streams) return old
        const exists = old.streams.some((s) => s.id === payload.stream.id)
        if (exists) {
          const isMember = old.streamMemberships?.some((m) => m.streamId === payload.stream.id)
          // Stream went private and user isn't a member — remove from sidebar
          if (payload.stream.visibility === "private" && !isMember) {
            return { ...old, streams: old.streams.filter((s) => s.id !== payload.stream.id) }
          }
          return {
            ...old,
            streams: old.streams.map((s) => (s.id === payload.stream.id ? { ...s, ...payload.stream } : s)),
          }
        }
        // Stream not in list — add if now visible (e.g. became public)
        if (payload.stream.visibility === "public") {
          return { ...old, streams: [...old.streams, { ...payload.stream, lastMessagePreview: null }] }
        }
        return old
      })

      // Update IndexedDB
      db.streams.put({ ...payload.stream, _cachedAt: Date.now() })
    })

    // Handle stream archived
    socket.on("stream:archived", (payload: StreamPayload) => {
      // Update stream bootstrap cache with archived stream
      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, payload.stream.id), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        return { ...old, stream: payload.stream }
      })

      // Remove from workspace bootstrap cache (sidebar - archived streams don't show)
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { streams?: Stream[] }
        if (!bootstrap.streams) return old
        return {
          ...bootstrap,
          streams: bootstrap.streams.filter((s) => s.id !== payload.stream.id),
        }
      })

      // Update IndexedDB
      db.streams.put({ ...payload.stream, _cachedAt: Date.now() })
    })

    // Handle stream unarchived
    socket.on("stream:unarchived", (payload: StreamPayload) => {
      // Update stream bootstrap cache with unarchived stream
      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, payload.stream.id), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        return { ...old, stream: payload.stream }
      })

      // Add back to workspace bootstrap cache (sidebar)
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { streams?: Stream[] }
        if (!bootstrap.streams) return old
        // Only add if not already present
        if (bootstrap.streams.some((s) => s.id === payload.stream.id)) {
          // Update existing entry - merge to preserve lastMessagePreview
          return {
            ...bootstrap,
            streams: bootstrap.streams.map((s) => (s.id === payload.stream.id ? { ...s, ...payload.stream } : s)),
          }
        }
        return {
          ...bootstrap,
          streams: [...bootstrap.streams, payload.stream],
        }
      })

      // Update IndexedDB
      db.streams.put({ ...payload.stream, _cachedAt: Date.now() })
    })

    // Handle workspace member added
    socket.on("workspace_member:added", (payload: WorkspaceMemberAddedPayload) => {
      const now = Date.now()
      const { member } = payload

      // Update workspace bootstrap cache - add member and user if not present
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { members?: WorkspaceMember[]; users?: User[] }

        const members = bootstrap.members || []
        const updatedMembers = members.some((m) => m.id === member.id)
          ? members
          : [
              ...members,
              {
                id: member.id,
                workspaceId: member.workspaceId,
                userId: member.userId,
                role: member.role as WorkspaceMember["role"],
                slug: member.slug,
                name: member.name,
                description: member.description,
                avatarUrl: member.avatarUrl,
                avatarStatus: member.avatarStatus,
                timezone: member.timezone,
                locale: member.locale,
                setupCompleted: member.setupCompleted,
                joinedAt: member.joinedAt,
              },
            ]

        return { ...bootstrap, members: updatedMembers }
      })

      // Cache member to IndexedDB
      db.workspaceMembers.put({
        id: member.id,
        workspaceId: member.workspaceId,
        userId: member.userId,
        role: member.role as "owner" | "admin" | "member",
        slug: member.slug,
        name: member.name,
        description: member.description,
        avatarUrl: member.avatarUrl,
        avatarStatus: member.avatarStatus,
        timezone: member.timezone,
        locale: member.locale,
        setupCompleted: member.setupCompleted,
        joinedAt: member.joinedAt,
        _cachedAt: now,
      })
    })

    // Handle workspace member removed
    socket.on("workspace_member:removed", (payload: WorkspaceMemberRemovedPayload) => {
      // Update workspace bootstrap cache
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { members?: WorkspaceMember[] }
        if (!bootstrap.members) return old
        return {
          ...bootstrap,
          members: bootstrap.members.filter((m) => m.id !== payload.memberId),
        }
      })

      // Remove from IndexedDB workspace members
      db.workspaceMembers.delete(payload.memberId)
    })

    // Handle member updated
    socket.on("member:updated", (payload: MemberUpdatedPayload) => {
      const now = Date.now()
      const { member } = payload

      // Update workspace bootstrap cache — update both member and user records
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { members?: WorkspaceMember[]; users?: User[] }

        const updatedMembers = bootstrap.members?.map((m) =>
          m.id === member.id
            ? {
                id: member.id,
                workspaceId: member.workspaceId,
                userId: member.userId,
                role: member.role as WorkspaceMember["role"],
                slug: member.slug,
                name: member.name,
                description: member.description,
                avatarUrl: member.avatarUrl,
                avatarStatus: member.avatarStatus,
                timezone: member.timezone,
                locale: member.locale,
                setupCompleted: member.setupCompleted,
                joinedAt: member.joinedAt,
              }
            : m
        )

        return { ...bootstrap, members: updatedMembers }
      })

      // Update IndexedDB
      db.workspaceMembers.put({
        id: member.id,
        workspaceId: member.workspaceId,
        userId: member.userId,
        role: member.role as "owner" | "admin" | "member",
        slug: member.slug,
        name: member.name,
        description: member.description,
        avatarUrl: member.avatarUrl,
        avatarStatus: member.avatarStatus,
        timezone: member.timezone,
        locale: member.locale,
        setupCompleted: member.setupCompleted,
        joinedAt: member.joinedAt,
        _cachedAt: now,
      })
    })

    // Handle stream read (from other sessions of the same user)
    // Backend marks ALL stream activity as read (mentions + message notifications)
    socket.on("stream:read", (payload: StreamReadPayload) => {
      if (payload.workspaceId !== workspaceId) return

      const current = queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId))
      const hadActivity = (current?.activityCounts[payload.streamId] ?? 0) > 0

      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old
        const clearedActivity = old.activityCounts[payload.streamId] ?? 0
        return {
          ...old,
          unreadCounts: {
            ...old.unreadCounts,
            [payload.streamId]: 0,
          },
          mentionCounts: {
            ...old.mentionCounts,
            [payload.streamId]: 0,
          },
          activityCounts: {
            ...old.activityCounts,
            [payload.streamId]: 0,
          },
          unreadActivityCount: Math.max(0, (old.unreadActivityCount ?? 0) - clearedActivity),
        }
      })

      if (hadActivity) {
        queryClient.invalidateQueries({ queryKey: ["activity", workspaceId] })
      }
    })

    // Handle all streams read (from other sessions of the same user)
    socket.on("stream:read_all", (payload: StreamsReadAllPayload) => {
      if (payload.workspaceId !== workspaceId) return

      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old

        const newUnreadCounts = { ...old.unreadCounts }
        const newMentionCounts = { ...old.mentionCounts }
        const newActivityCounts = { ...old.activityCounts }
        let clearedActivity = 0
        for (const streamId of payload.streamIds) {
          newUnreadCounts[streamId] = 0
          newMentionCounts[streamId] = 0
          clearedActivity += newActivityCounts[streamId] ?? 0
          newActivityCounts[streamId] = 0
        }
        return {
          ...old,
          unreadCounts: newUnreadCounts,
          mentionCounts: newMentionCounts,
          activityCounts: newActivityCounts,
          unreadActivityCount: Math.max(0, (old.unreadActivityCount ?? 0) - clearedActivity),
        }
      })

      queryClient.invalidateQueries({ queryKey: ["activity", workspaceId] })
    })

    // Handle stream activity (when a new message is created in any stream)
    // Always updates the preview, but only increments unread for others' messages
    socket.on("stream:activity", (payload: StreamActivityPayload) => {
      // Only update if it's for this workspace
      if (payload.workspaceId !== workspaceId) return

      const isViewingStream = currentStreamIdRef.current === payload.streamId

      // If not viewing this stream, invalidate its bootstrap cache so it refetches
      // when the user navigates there. (If viewing, useStreamSocket handles updates.)
      if (!isViewingStream) {
        queryClient.invalidateQueries({
          queryKey: streamKeys.bootstrap(workspaceId, payload.streamId),
        })
      }

      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old

        // Only update if user is a member of this stream
        const isMember = old.streamMemberships.some((m: StreamMember) => m.streamId === payload.streamId)
        if (!isMember) return old

        // Determine if we should increment unread count:
        // - Not for own messages (authorId is now a memberId — match via member.userId)
        // - Not when currently viewing the stream
        const currentMember = user && old.members?.find((m: WorkspaceMember) => m.userId === user.id)
        const isOwnMessage = currentMember && payload.authorId === currentMember.id
        const shouldIncrementUnread = !isOwnMessage && !isViewingStream

        return {
          ...old,
          // Only increment unread count for others' messages when not viewing
          unreadCounts: shouldIncrementUnread
            ? {
                ...old.unreadCounts,
                [payload.streamId]: (old.unreadCounts[payload.streamId] ?? 0) + 1,
              }
            : old.unreadCounts,
          // Always update stream's lastMessagePreview for sidebar display
          streams: old.streams.map((stream) =>
            stream.id === payload.streamId ? { ...stream, lastMessagePreview: payload.lastMessagePreview } : stream
          ),
        }
      })
    })

    // Handle stream display name updated (from auto-naming service)
    socket.on("stream:display_name_updated", (payload: StreamDisplayNameUpdatedPayload) => {
      // Update stream detail cache
      queryClient.setQueryData(streamKeys.detail(workspaceId, payload.streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        return { ...old, displayName: payload.displayName }
      })

      // Update stream bootstrap cache
      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, payload.streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { stream?: Stream }
        if (!bootstrap.stream) return old
        return { ...old, stream: { ...bootstrap.stream, displayName: payload.displayName } }
      })

      // Update workspace bootstrap cache (sidebar)
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { streams?: Stream[] }
        if (!bootstrap.streams) return old
        return {
          ...bootstrap,
          streams: bootstrap.streams.map((s) =>
            s.id === payload.streamId ? { ...s, displayName: payload.displayName } : s
          ),
        }
      })

      // Update IndexedDB
      db.streams.update(payload.streamId, { displayName: payload.displayName, _cachedAt: Date.now() })
    })

    // Handle stream member added
    socket.on(
      "stream:member_added",
      (payload: { workspaceId: string; streamId: string; memberId: string; stream: Stream }) => {
        if (payload.workspaceId !== workspaceId) return

        // Update stream bootstrap members list
        queryClient.setQueryData(streamKeys.bootstrap(workspaceId, payload.streamId), (old: unknown) => {
          if (!old || typeof old !== "object") return old
          const bootstrap = old as { members?: StreamMember[] }
          if (!bootstrap.members) return old
          const exists = bootstrap.members.some((m: StreamMember) => m.memberId === payload.memberId)
          if (exists) return old
          return {
            ...bootstrap,
            members: [
              ...bootstrap.members,
              {
                streamId: payload.streamId,
                memberId: payload.memberId,
                pinned: false,
                pinnedAt: null,
                notificationLevel: null,
                lastReadEventId: null,
                lastReadAt: null,
                joinedAt: new Date().toISOString(),
              },
            ],
          }
        })

        // If the added member is the current user, add to streamMemberships + sidebar
        queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
          if (!old) return old
          const currentMember = user && old.members?.find((m: WorkspaceMember) => m.userId === user.id)
          if (!currentMember || payload.memberId !== currentMember.id) return old

          const membershipExists = old.streamMemberships.some((m: StreamMember) => m.streamId === payload.streamId)
          const streamExists = old.streams?.some((s) => s.id === payload.streamId)

          return {
            ...old,
            streamMemberships: membershipExists
              ? old.streamMemberships
              : [
                  ...old.streamMemberships,
                  {
                    streamId: payload.streamId,
                    memberId: payload.memberId,
                    pinned: false,
                    pinnedAt: null,
                    notificationLevel: null,
                    lastReadEventId: null,
                    lastReadAt: null,
                    joinedAt: new Date().toISOString(),
                  },
                ],
            streams: streamExists
              ? old.streams
              : [...(old.streams ?? []), { ...payload.stream, lastMessagePreview: null }],
          }
        })
      }
    )

    // Handle stream member removed
    socket.on("stream:member_removed", (payload: { workspaceId: string; streamId: string; memberId: string }) => {
      if (payload.workspaceId !== workspaceId) return

      // Update stream bootstrap members list
      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, payload.streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { members?: StreamMember[] }
        if (!bootstrap.members) return old
        return {
          ...bootstrap,
          members: bootstrap.members.filter((m: StreamMember) => m.memberId !== payload.memberId),
        }
      })

      // If the removed member is the current user, remove from streamMemberships
      // and remove private streams from sidebar (no longer visible)
      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old
        const currentMember = user && old.members?.find((m: WorkspaceMember) => m.userId === user.id)
        if (!currentMember || payload.memberId !== currentMember.id) return old

        const removedStream = old.streams?.find((s) => s.id === payload.streamId)
        const shouldRemoveFromSidebar = removedStream?.visibility === "private"

        return {
          ...old,
          streamMemberships: old.streamMemberships.filter((m: StreamMember) => m.streamId !== payload.streamId),
          streams: shouldRemoveFromSidebar ? old.streams?.filter((s) => s.id !== payload.streamId) : old.streams,
        }
      })
    })

    // Handle user preferences updated (from other sessions of the same user)
    socket.on("user_preferences:updated", (payload: UserPreferencesUpdatedPayload) => {
      // Only update if it's for this workspace
      if (payload.workspaceId !== workspaceId) return

      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old
        return {
          ...old,
          userPreferences: payload.preferences,
        }
      })
    })

    // Handle activity created (mentions and notification-level activities)
    socket.on("activity:created", (payload: ActivityCreatedPayload) => {
      if (payload.workspaceId !== workspaceId) return

      const { streamId, activityType } = payload.activity

      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old
        return {
          ...old,
          mentionCounts:
            activityType === "mention"
              ? { ...old.mentionCounts, [streamId]: (old.mentionCounts[streamId] ?? 0) + 1 }
              : old.mentionCounts,
          activityCounts: {
            ...old.activityCounts,
            [streamId]: (old.activityCounts[streamId] ?? 0) + 1,
          },
          unreadActivityCount: (old.unreadActivityCount ?? 0) + 1,
        }
      })

      // Invalidate activity feed so it refetches when the page is mounted
      queryClient.invalidateQueries({ queryKey: ["activity", workspaceId] })
    })

    return () => {
      abortController.abort()
      socket.emit("leave", `ws:${workspaceId}`)
      socket.off("stream:created")
      socket.off("stream:updated")
      socket.off("stream:archived")
      socket.off("stream:unarchived")
      socket.off("stream:display_name_updated")
      socket.off("workspace_member:added")
      socket.off("workspace_member:removed")
      socket.off("member:updated")
      socket.off("stream:read")
      socket.off("stream:read_all")
      socket.off("stream:activity")
      socket.off("stream:member_added")
      socket.off("stream:member_removed")
      socket.off("user_preferences:updated")
      socket.off("activity:created")
    }
  }, [socket, workspaceId, queryClient, user, reconnectCount])
}
