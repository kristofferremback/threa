import { useEffect, useMemo, useRef } from "react"
import { useQueryClient, useQuery, type QueryClient } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { useSocket, useSocketReconnectCount } from "@/contexts"
import { useAuth } from "@/auth"
import { debugBootstrap } from "@/lib/bootstrap-debug"
import { db } from "@/db"
import { joinRoomFireAndForget } from "@/lib/socket-room"
import { SW_MSG_CLEAR_NOTIFICATIONS } from "@/lib/sw-messages"
import { streamKeys } from "./use-streams"
import { workspaceKeys } from "./use-workspaces"
import type {
  Stream,
  User,
  Bot,
  WorkspaceBootstrap,
  StreamMember,
  UserPreferences,
  LastMessagePreview,
  ActivityCreatedPayload,
} from "@threa/types"
import { StreamTypes } from "@threa/types"

/**
 * Update the workspace bootstrap cache, or invalidate if it's not cached yet.
 *
 * Socket events can arrive before the bootstrap queryFn completes (the member
 * room is joined before the fetch finishes). Without this guard, setQueryData
 * sees `old === undefined` and silently drops the update. Invalidating triggers
 * a re-fetch that will include the event's state from the DB.
 *
 * Returns true if the update was applied, false if invalidated instead.
 */
function updateBootstrapOrInvalidate(
  queryClient: QueryClient,
  workspaceId: string,
  updater: (old: WorkspaceBootstrap) => WorkspaceBootstrap
): boolean {
  const key = workspaceKeys.bootstrap(workspaceId)
  if (!queryClient.getQueryData(key)) {
    queryClient.invalidateQueries({ queryKey: key })
    return false
  }
  queryClient.setQueryData<WorkspaceBootstrap>(key, (old) => {
    if (!old) return old
    return updater(old)
  })
  return true
}

function getWorkspaceUsers(bootstrap: WorkspaceBootstrap): User[] {
  return bootstrap.users
}

function withWorkspaceUsers(bootstrap: WorkspaceBootstrap, users: User[]): WorkspaceBootstrap {
  return {
    ...bootstrap,
    users,
  }
}

function toWorkspaceUser(user: WorkspaceUserPayload): User {
  return { ...user }
}

/** Workspace user shape from backend user repository. */
interface WorkspaceUserPayload {
  id: string
  workspaceId: string
  workosUserId: string
  role: User["role"]
  slug: string
  name: string
  description: string | null
  avatarUrl: string | null
  timezone: string | null
  locale: string | null
  pronouns: string | null
  phone: string | null
  githubUsername: string | null
  setupCompleted: boolean
  email: string
  joinedAt: string
}

interface StreamPayload {
  workspaceId: string
  streamId: string
  stream: Stream
  dmUserIds?: [string, string]
}

interface WorkspaceUserAddedPayload {
  workspaceId: string
  user: WorkspaceUserPayload
}

interface WorkspaceUserRemovedPayload {
  workspaceId: string
  removedUserId: string
}

interface WorkspaceUserUpdatedPayload {
  workspaceId: string
  user: WorkspaceUserPayload
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

  // Keep user in a ref so handler effects don't churn when auth hydration settles.
  const userRef = useRef(user)
  userRef.current = user

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
      const applied = updateBootstrapOrInvalidate(queryClient, workspaceId, (old) => {
        const streamExists = old.streams.some((s) => s.id === payload.stream.id)
        const currentUser = userRef.current
        const currentMember = currentUser && getWorkspaceUsers(old).find((u) => u.workosUserId === currentUser.id)
        const currentUserId = currentMember?.id ?? null
        const isCreator = Boolean(currentMember && payload.stream.createdBy === currentMember.id)
        const isDmParticipant =
          payload.stream.type === StreamTypes.DM &&
          currentUserId !== null &&
          payload.dmUserIds?.includes(currentUserId) === true
        const hasMembership = old.streamMemberships.some((m: StreamMember) => m.streamId === payload.stream.id)
        const shouldAddMembership = Boolean(currentUserId && !hasMembership && (isCreator || isDmParticipant))
        const shouldAddStream = !streamExists && payload.stream.type !== StreamTypes.DM

        // Ensure members are subscribed immediately for follow-up stream activity.
        shouldJoinStreamRoom = hasMembership || shouldAddMembership

        if (streamExists && !shouldAddMembership) return old

        return {
          ...old,
          // DM payloads do not include viewer-resolved names. Avoid inserting
          // placeholder "Direct message" entries and wait for bootstrap refetch.
          streams: shouldAddStream ? [...old.streams, { ...payload.stream, lastMessagePreview: null }] : old.streams,
          streamMemberships: shouldAddMembership
            ? [
                ...old.streamMemberships,
                {
                  streamId: payload.stream.id,
                  memberId: currentUserId!,
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

      if (applied && shouldJoinStreamRoom) {
        joinRoomFireAndForget(
          socket,
          `ws:${workspaceId}:stream:${payload.stream.id}`,
          abortController.signal,
          "SocketEvents"
        )
      }

      // Cache to IndexedDB
      db.streams.put({ ...payload.stream, _cachedAt: Date.now() })

      // DM creation still requires bootstrap refetch for viewer-specific dmPeers and
      // resolved display names in the sidebar.
      if (payload.stream.type === StreamTypes.DM) {
        void queryClient.refetchQueries({ queryKey: workspaceKeys.bootstrap(workspaceId), type: "active" })
      }
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
            streams: old.streams.map((s) =>
              s.id === payload.stream.id
                ? {
                    ...s,
                    ...payload.stream,
                    displayName:
                      payload.stream.type === StreamTypes.DM && payload.stream.displayName == null
                        ? s.displayName
                        : payload.stream.displayName,
                  }
                : s
            ),
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

    // Handle workspace user added
    socket.on("workspace_user:added", (payload: WorkspaceUserAddedPayload) => {
      const now = Date.now()
      const { user } = payload

      // Update workspace bootstrap cache with user if not already present.
      updateBootstrapOrInvalidate(queryClient, workspaceId, (old) => {
        const users = getWorkspaceUsers(old)
        const incomingUser = toWorkspaceUser(user)
        const updatedUsers = users.some((u) => u.id === user.id) ? users : [...users, incomingUser]

        return withWorkspaceUsers(old, updatedUsers)
      })

      // Cache user to IndexedDB
      db.workspaceUsers.put({
        ...toWorkspaceUser(user),
        _cachedAt: now,
      })
    })

    // Handle workspace user removed
    socket.on("workspace_user:removed", (payload: WorkspaceUserRemovedPayload) => {
      // Update workspace bootstrap cache
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as WorkspaceBootstrap
        const users = getWorkspaceUsers(bootstrap)
        return withWorkspaceUsers(
          bootstrap,
          users.filter((u) => u.id !== payload.removedUserId)
        )
      })

      // Remove from IndexedDB workspace users
      db.workspaceUsers.delete(payload.removedUserId)
    })

    // Handle workspace user updated
    socket.on("workspace_user:updated", (payload: WorkspaceUserUpdatedPayload) => {
      const now = Date.now()
      const { user } = payload

      // Update workspace bootstrap cache.
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as WorkspaceBootstrap
        const users = getWorkspaceUsers(bootstrap)
        const incomingUser = toWorkspaceUser(user)
        const updatedUsers = users.map((u) => (u.id === user.id ? incomingUser : u))

        return withWorkspaceUsers(bootstrap, updatedUsers)
      })

      // Update IndexedDB
      db.workspaceUsers.put({
        ...toWorkspaceUser(user),
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

      // Dismiss push notification for this stream (fast path when the app is open)
      navigator.serviceWorker?.controller?.postMessage({
        type: SW_MSG_CLEAR_NOTIFICATIONS,
        streamId: payload.streamId,
      })
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

      // Dismiss push notifications for all read streams (fast path when the app is open)
      for (const streamId of payload.streamIds) {
        navigator.serviceWorker?.controller?.postMessage({
          type: SW_MSG_CLEAR_NOTIFICATIONS,
          streamId,
        })
      }
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
        // - Not for own messages (authorId is a userId — match via user.workosUserId)
        // - Not when currently viewing the stream
        const currentUser = userRef.current
        const currentMember = currentUser && getWorkspaceUsers(old).find((u) => u.workosUserId === currentUser.id)
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
        updateBootstrapOrInvalidate(queryClient, workspaceId, (old) => {
          const currentUser = userRef.current
          const currentMember = currentUser && getWorkspaceUsers(old).find((u) => u.workosUserId === currentUser.id)
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
        const currentUser = userRef.current
        const currentMember = currentUser && getWorkspaceUsers(old).find((u) => u.workosUserId === currentUser.id)
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

    // Handle bot created
    socket.on("bot:created", (payload: { workspaceId: string; bot: Bot }) => {
      if (payload.workspaceId !== workspaceId) return

      updateBootstrapOrInvalidate(queryClient, workspaceId, (old) => {
        const exists = old.bots?.some((b) => b.id === payload.bot.id)
        if (exists) return old
        return { ...old, bots: [...(old.bots ?? []), payload.bot] }
      })

      db.bots.put({ ...payload.bot, _cachedAt: Date.now() })
    })

    // Handle bot updated
    socket.on("bot:updated", (payload: { workspaceId: string; bot: Bot }) => {
      if (payload.workspaceId !== workspaceId) return

      updateBootstrapOrInvalidate(queryClient, workspaceId, (old) => {
        const exists = old.bots?.some((b) => b.id === payload.bot.id)
        if (exists) {
          return { ...old, bots: (old.bots ?? []).map((b) => (b.id === payload.bot.id ? payload.bot : b)) }
        }
        return { ...old, bots: [...(old.bots ?? []), payload.bot] }
      })

      db.bots.put({ ...payload.bot, _cachedAt: Date.now() })
    })

    // Handle activity created (mentions and notification-level activities)
    socket.on("activity:created", (payload: ActivityCreatedPayload) => {
      if (payload.workspaceId !== workspaceId) return

      const { streamId, activityType } = payload.activity

      updateBootstrapOrInvalidate(queryClient, workspaceId, (old) => ({
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
      }))

      // Invalidate activity feed so it refetches when the page is mounted
      queryClient.invalidateQueries({ queryKey: ["activity", workspaceId] })
    })

    return () => {
      abortController.abort()
      // Do NOT leave workspace room here. Multiple hooks perform ws joins and Socket.io
      // rooms are not reference-counted; one leave can drop member-scoped delivery.
      socket.off("stream:created")
      socket.off("stream:updated")
      socket.off("stream:archived")
      socket.off("stream:unarchived")
      socket.off("stream:display_name_updated")
      socket.off("workspace_user:added")
      socket.off("workspace_user:removed")
      socket.off("workspace_user:updated")
      socket.off("stream:read")
      socket.off("stream:read_all")
      socket.off("stream:activity")
      socket.off("stream:member_added")
      socket.off("stream:member_removed")
      socket.off("user_preferences:updated")
      socket.off("bot:created")
      socket.off("bot:updated")
      socket.off("activity:created")
    }
  }, [socket, workspaceId, queryClient, reconnectCount])
}
