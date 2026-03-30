import { db } from "@/db"
import type { Socket } from "socket.io-client"
import type { QueryClient } from "@tanstack/react-query"
import { joinRoomFireAndForget } from "@/lib/socket-room"
import { SW_MSG_CLEAR_NOTIFICATIONS } from "@/lib/sw-messages"
import { streamKeys } from "@/hooks/use-streams"
import { workspaceKeys } from "@/hooks/use-workspaces"
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
import { StreamTypes, Visibilities } from "@threa/types"

// ============================================================================
// Workspace socket handler payload types
// ============================================================================

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

// ============================================================================
// Workspace socket handler helpers
// ============================================================================

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

// ============================================================================
// Register workspace-level socket handlers
// ============================================================================

/**
 * Registers all workspace-level socket event handlers and returns a cleanup
 * function that unregisters them.
 *
 * Extracted from `useSocketEvents` so the SyncEngine can own handler lifecycle
 * without React hooks.
 */
export function registerWorkspaceSocketHandlers(
  socket: Socket,
  workspaceId: string,
  queryClient: QueryClient,
  refs: {
    getCurrentStreamId: () => string | undefined
    getCurrentUser: () => { id: string } | null
  }
): () => void {
  const abortController = new AbortController()

  // Handle stream created
  const handleStreamCreated = (payload: StreamPayload) => {
    let shouldJoinStreamRoom = false
    let shouldCacheStream = payload.stream.visibility !== Visibilities.PRIVATE

    // Add to workspace bootstrap cache (sidebar)
    const applied = updateBootstrapOrInvalidate(queryClient, workspaceId, (old) => {
      const streamExists = old.streams.some((s) => s.id === payload.stream.id)
      const currentUser = refs.getCurrentUser()
      const currentMember = currentUser && getWorkspaceUsers(old).find((u) => u.workosUserId === currentUser.id)
      const currentUserId = currentMember?.id ?? null
      const isCreator = Boolean(currentMember && payload.stream.createdBy === currentMember.id)
      const isDmParticipant =
        payload.stream.type === StreamTypes.DM &&
        currentUserId !== null &&
        payload.dmUserIds?.includes(currentUserId) === true
      const hasMembership = old.streamMemberships.some((m: StreamMember) => m.streamId === payload.stream.id)
      const shouldAddMembership = Boolean(currentUserId && !hasMembership && (isCreator || isDmParticipant))
      const isPrivate = payload.stream.visibility === Visibilities.PRIVATE
      const shouldAddStream =
        !streamExists &&
        payload.stream.type !== StreamTypes.DM &&
        // Private streams (scratchpads, private channels) — only add to sidebar for the creator.
        // Other members are added via stream:member_added.
        (!isPrivate || isCreator)

      // Ensure members are subscribed immediately for follow-up stream activity.
      shouldJoinStreamRoom = hasMembership || shouldAddMembership
      shouldCacheStream = !isPrivate || isCreator

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
        "WorkspaceSync"
      )
    }

    // Cache to IndexedDB — skip other users' scratchpads to avoid stale
    // entries resurfacing on hydration if the event leaks during a deploy race.
    if (shouldCacheStream) {
      db.streams.put({ ...payload.stream, _cachedAt: Date.now() })
    }

    // DM creation still requires bootstrap refetch for viewer-specific dmPeers and
    // resolved display names in the sidebar.
    if (payload.stream.type === StreamTypes.DM) {
      void queryClient.refetchQueries({ queryKey: workspaceKeys.bootstrap(workspaceId), type: "active" })
    }
  }

  // Handle stream updated
  const handleStreamUpdated = (payload: StreamPayload) => {
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
  }

  // Handle stream archived
  const handleStreamArchived = (payload: StreamPayload) => {
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
  }

  // Handle stream unarchived
  const handleStreamUnarchived = (payload: StreamPayload) => {
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
  }

  // Handle workspace user added
  const handleWorkspaceUserAdded = (payload: WorkspaceUserAddedPayload) => {
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
  }

  // Handle workspace user removed
  const handleWorkspaceUserRemoved = (payload: WorkspaceUserRemovedPayload) => {
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
  }

  // Handle workspace user updated
  const handleWorkspaceUserUpdated = (payload: WorkspaceUserUpdatedPayload) => {
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
  }

  // Handle stream read (from other sessions of the same user)
  // Backend marks ALL stream activity as read (mentions + message notifications)
  const handleStreamRead = (payload: StreamReadPayload) => {
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

    // Update IDB unread state
    db.transaction("rw", [db.unreadState], async () => {
      const state = await db.unreadState.get(workspaceId)
      if (!state) return
      const clearedActivity = state.activityCounts[payload.streamId] ?? 0
      await db.unreadState.put({
        ...state,
        unreadCounts: { ...state.unreadCounts, [payload.streamId]: 0 },
        mentionCounts: { ...state.mentionCounts, [payload.streamId]: 0 },
        activityCounts: { ...state.activityCounts, [payload.streamId]: 0 },
        unreadActivityCount: Math.max(0, state.unreadActivityCount - clearedActivity),
        _cachedAt: Date.now(),
      })
    })

    if (hadActivity) {
      queryClient.invalidateQueries({ queryKey: ["activity", workspaceId] })
    }

    // Dismiss push notification for this stream (fast path when the app is open)
    navigator.serviceWorker?.controller?.postMessage({
      type: SW_MSG_CLEAR_NOTIFICATIONS,
      streamId: payload.streamId,
    })
  }

  // Handle all streams read (from other sessions of the same user)
  const handleStreamReadAll = (payload: StreamsReadAllPayload) => {
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

    // Update IDB unread state
    db.transaction("rw", [db.unreadState], async () => {
      const state = await db.unreadState.get(workspaceId)
      if (!state) return
      const updated = { ...state, _cachedAt: Date.now() }
      const newUnread = { ...state.unreadCounts }
      const newMention = { ...state.mentionCounts }
      const newActivity = { ...state.activityCounts }
      let cleared = 0
      for (const sid of payload.streamIds) {
        newUnread[sid] = 0
        newMention[sid] = 0
        cleared += newActivity[sid] ?? 0
        newActivity[sid] = 0
      }
      updated.unreadCounts = newUnread
      updated.mentionCounts = newMention
      updated.activityCounts = newActivity
      updated.unreadActivityCount = Math.max(0, state.unreadActivityCount - cleared)
      db.unreadState.put(updated)
    })

    queryClient.invalidateQueries({ queryKey: ["activity", workspaceId] })

    // Dismiss push notifications for all read streams (fast path when the app is open)
    for (const streamId of payload.streamIds) {
      navigator.serviceWorker?.controller?.postMessage({
        type: SW_MSG_CLEAR_NOTIFICATIONS,
        streamId,
      })
    }
  }

  // Handle stream activity (when a new message is created in any stream)
  // Always updates the preview, but only increments unread for others' messages
  const handleStreamActivity = (payload: StreamActivityPayload) => {
    // Only update if it's for this workspace
    if (payload.workspaceId !== workspaceId) return

    const isViewingStream = refs.getCurrentStreamId() === payload.streamId

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
      const currentUser = refs.getCurrentUser()
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

    // Update IDB: increment unread count for others' messages when not viewing.
    // We check membership via IDB to avoid dependency on the TanStack closure.
    if (!isViewingStream) {
      void (async () => {
        const membership = await db.streamMemberships.get(`${workspaceId}:${payload.streamId}`)
        if (!membership) return
        const currentUser = refs.getCurrentUser()
        const currentMember = currentUser
          ? await db.workspaceUsers
              .where("workspaceId")
              .equals(workspaceId)
              .filter((u) => u.workosUserId === currentUser.id)
              .first()
          : null
        if (currentMember && payload.authorId === currentMember.id) return

        await db.transaction("rw", [db.unreadState], async () => {
          const state = await db.unreadState.get(workspaceId)
          if (!state) return
          await db.unreadState.put({
            ...state,
            unreadCounts: {
              ...state.unreadCounts,
              [payload.streamId]: (state.unreadCounts[payload.streamId] ?? 0) + 1,
            },
            _cachedAt: Date.now(),
          })
        })
      })()
    }
  }

  // Handle stream display name updated (from auto-naming service)
  const handleStreamDisplayNameUpdated = (payload: StreamDisplayNameUpdatedPayload) => {
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
  }

  // Handle stream member added
  const handleStreamMemberAdded = (payload: {
    workspaceId: string
    streamId: string
    memberId: string
    stream: Stream
  }) => {
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
      const currentUser = refs.getCurrentUser()
      const currentMember = currentUser && getWorkspaceUsers(old).find((u) => u.workosUserId === currentUser.id)
      if (!currentMember || payload.memberId !== currentMember.id) return old

      const membershipExists = old.streamMemberships.some((m: StreamMember) => m.streamId === payload.streamId)
      const streamExists = old.streams?.some((s) => s.id === payload.streamId)

      // Write membership to IDB
      if (!membershipExists) {
        const now = Date.now()
        db.streamMemberships.put({
          id: `${workspaceId}:${payload.streamId}`,
          workspaceId,
          streamId: payload.streamId,
          memberId: payload.memberId,
          pinned: false,
          pinnedAt: null,
          notificationLevel: null,
          lastReadEventId: null,
          lastReadAt: null,
          joinedAt: new Date().toISOString(),
          _cachedAt: now,
        })
      }
      if (!streamExists) {
        db.streams.put({ ...payload.stream, _cachedAt: Date.now() })
      }

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
        streams: streamExists ? old.streams : [...(old.streams ?? []), { ...payload.stream, lastMessagePreview: null }],
      }
    })
  }

  // Handle stream member removed
  const handleStreamMemberRemoved = (payload: { workspaceId: string; streamId: string; memberId: string }) => {
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
      const currentUser = refs.getCurrentUser()
      const currentMember = currentUser && getWorkspaceUsers(old).find((u) => u.workosUserId === currentUser.id)
      if (!currentMember || payload.memberId !== currentMember.id) return old

      // Remove membership from IDB
      db.streamMemberships.delete(`${workspaceId}:${payload.streamId}`)

      const removedStream = old.streams?.find((s) => s.id === payload.streamId)
      const shouldRemoveFromSidebar = removedStream?.visibility === "private"
      if (shouldRemoveFromSidebar) {
        db.streams.delete(payload.streamId)
      }

      return {
        ...old,
        streamMemberships: old.streamMemberships.filter((m: StreamMember) => m.streamId !== payload.streamId),
        streams: shouldRemoveFromSidebar ? old.streams?.filter((s) => s.id !== payload.streamId) : old.streams,
      }
    })
  }

  // Handle user preferences updated (from other sessions of the same user)
  const handleUserPreferencesUpdated = (payload: UserPreferencesUpdatedPayload) => {
    // Only update if it's for this workspace
    if (payload.workspaceId !== workspaceId) return

    queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
      if (!old) return old
      return {
        ...old,
        userPreferences: payload.preferences,
      }
    })

    // Write to IDB
    db.userPreferences.put({
      ...payload.preferences,
      id: workspaceId,
      workspaceId,
      _cachedAt: Date.now(),
    })
  }

  // Handle bot created
  const handleBotCreated = (payload: { workspaceId: string; bot: Bot }) => {
    if (payload.workspaceId !== workspaceId) return

    updateBootstrapOrInvalidate(queryClient, workspaceId, (old) => {
      const exists = old.bots?.some((b) => b.id === payload.bot.id)
      if (exists) return old
      return { ...old, bots: [...(old.bots ?? []), payload.bot] }
    })

    db.bots.put({ ...payload.bot, _cachedAt: Date.now() })
  }

  // Handle bot updated
  const handleBotUpdated = (payload: { workspaceId: string; bot: Bot }) => {
    if (payload.workspaceId !== workspaceId) return

    updateBootstrapOrInvalidate(queryClient, workspaceId, (old) => {
      const exists = old.bots?.some((b) => b.id === payload.bot.id)
      if (exists) {
        return { ...old, bots: (old.bots ?? []).map((b) => (b.id === payload.bot.id ? payload.bot : b)) }
      }
      return { ...old, bots: [...(old.bots ?? []), payload.bot] }
    })

    db.bots.put({ ...payload.bot, _cachedAt: Date.now() })
  }

  // Handle activity created (mentions and notification-level activities)
  const handleActivityCreated = (payload: ActivityCreatedPayload) => {
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

    // Update IDB unread state
    db.transaction("rw", [db.unreadState], async () => {
      const state = await db.unreadState.get(workspaceId)
      if (!state) return
      await db.unreadState.put({
        ...state,
        mentionCounts:
          activityType === "mention"
            ? { ...state.mentionCounts, [streamId]: (state.mentionCounts[streamId] ?? 0) + 1 }
            : state.mentionCounts,
        activityCounts: {
          ...state.activityCounts,
          [streamId]: (state.activityCounts[streamId] ?? 0) + 1,
        },
        unreadActivityCount: state.unreadActivityCount + 1,
        _cachedAt: Date.now(),
      })
    })

    // Invalidate activity feed so it refetches when the page is mounted
    queryClient.invalidateQueries({ queryKey: ["activity", workspaceId] })
  }

  // Register all handlers
  socket.on("stream:created", handleStreamCreated)
  socket.on("stream:updated", handleStreamUpdated)
  socket.on("stream:archived", handleStreamArchived)
  socket.on("stream:unarchived", handleStreamUnarchived)
  socket.on("workspace_user:added", handleWorkspaceUserAdded)
  socket.on("workspace_user:removed", handleWorkspaceUserRemoved)
  socket.on("workspace_user:updated", handleWorkspaceUserUpdated)
  socket.on("stream:read", handleStreamRead)
  socket.on("stream:read_all", handleStreamReadAll)
  socket.on("stream:activity", handleStreamActivity)
  socket.on("stream:display_name_updated", handleStreamDisplayNameUpdated)
  socket.on("stream:member_added", handleStreamMemberAdded)
  socket.on("stream:member_removed", handleStreamMemberRemoved)
  socket.on("user_preferences:updated", handleUserPreferencesUpdated)
  socket.on("bot:created", handleBotCreated)
  socket.on("bot:updated", handleBotUpdated)
  socket.on("activity:created", handleActivityCreated)

  return () => {
    abortController.abort()
    // Do NOT leave workspace room here. Multiple hooks perform ws joins and Socket.io
    // rooms are not reference-counted; one leave can drop member-scoped delivery.
    socket.off("stream:created", handleStreamCreated)
    socket.off("stream:updated", handleStreamUpdated)
    socket.off("stream:archived", handleStreamArchived)
    socket.off("stream:unarchived", handleStreamUnarchived)
    socket.off("workspace_user:added", handleWorkspaceUserAdded)
    socket.off("workspace_user:removed", handleWorkspaceUserRemoved)
    socket.off("workspace_user:updated", handleWorkspaceUserUpdated)
    socket.off("stream:read", handleStreamRead)
    socket.off("stream:read_all", handleStreamReadAll)
    socket.off("stream:activity", handleStreamActivity)
    socket.off("stream:display_name_updated", handleStreamDisplayNameUpdated)
    socket.off("stream:member_added", handleStreamMemberAdded)
    socket.off("stream:member_removed", handleStreamMemberRemoved)
    socket.off("user_preferences:updated", handleUserPreferencesUpdated)
    socket.off("bot:created", handleBotCreated)
    socket.off("bot:updated", handleBotUpdated)
    socket.off("activity:created", handleActivityCreated)
  }
}

// ============================================================================
// Bootstrap application — writes workspace bootstrap data to IndexedDB
// ============================================================================

/**
 * Shred a WorkspaceBootstrap response into individual IDB tables.
 *
 * For workspace-scoped entities (streams, users, memberships, etc.), this
 * is a REPLACE: entities not in the bootstrap snapshot are deleted if they
 * were written before this bootstrap (`_cachedAt < now`). Entities written
 * concurrently by socket handlers (`_cachedAt >= now`) are preserved.
 *
 * This prevents stale data from accumulating across environments or DB resets.
 */
export async function applyWorkspaceBootstrap(
  workspaceId: string,
  bootstrap: WorkspaceBootstrap,
  fetchStartedAt?: number
): Promise<void> {
  const now = Date.now()

  // Build membership lookup for O(1) access when merging onto streams
  const membershipByStream = new Map(bootstrap.streamMemberships.map((sm) => [sm.streamId, sm]))

  await Promise.all([
    db.workspaces.put({ ...bootstrap.workspace, _cachedAt: now }),
    db.workspaceUsers.bulkPut(bootstrap.users.map((u) => ({ ...u, _cachedAt: now }))),
    db.streams.bulkPut(
      bootstrap.streams.map((s) => {
        const membership = membershipByStream.get(s.id)
        return {
          ...s,
          pinned: membership?.pinned,
          notificationLevel: membership?.notificationLevel,
          lastReadEventId: membership?.lastReadEventId,
          _cachedAt: now,
        }
      })
    ),
    db.streamMemberships.bulkPut(
      bootstrap.streamMemberships.map((sm) => ({
        ...sm,
        id: `${workspaceId}:${sm.streamId}`,
        workspaceId,
        _cachedAt: now,
      }))
    ),
    db.dmPeers.bulkPut(
      bootstrap.dmPeers.map((dp) => ({
        ...dp,
        id: `${workspaceId}:${dp.streamId}`,
        workspaceId,
        _cachedAt: now,
      }))
    ),
    db.personas.bulkPut(bootstrap.personas.map((p) => ({ ...p, _cachedAt: now }))),
    db.bots.bulkPut(bootstrap.bots.map((b) => ({ ...b, _cachedAt: now }))),
    db.unreadState.put({
      id: workspaceId,
      workspaceId,
      unreadCounts: bootstrap.unreadCounts,
      mentionCounts: bootstrap.mentionCounts,
      activityCounts: bootstrap.activityCounts,
      unreadActivityCount: bootstrap.unreadActivityCount,
      mutedStreamIds: bootstrap.mutedStreamIds,
      _cachedAt: now,
    }),
    db.userPreferences.put({
      ...bootstrap.userPreferences,
      id: workspaceId,
      workspaceId,
      _cachedAt: now,
    }),
    db.workspaceMetadata.put({
      id: workspaceId,
      workspaceId,
      emojis: bootstrap.emojis,
      emojiWeights: bootstrap.emojiWeights,
      commands: bootstrap.commands,
      _cachedAt: now,
    }),
  ])

  // Clean up stale entities: anything in IDB for this workspace that
  // wasn't in the bootstrap AND was written before this bootstrap.
  // Entities with _cachedAt >= now were written concurrently by socket
  // handlers and must be preserved.
  // Use the pre-fetch timestamp for stale cleanup. Entities written by
  // socket handlers DURING the fetch have _cachedAt > fetchStartedAt and
  // survive. Only truly stale entities (from before we started fetching)
  // are removed. If no fetchStartedAt provided, skip cleanup entirely.
  if (fetchStartedAt !== undefined) {
    await cleanupStaleEntities(workspaceId, bootstrap, fetchStartedAt)
  }
}

async function cleanupStaleEntities(workspaceId: string, bootstrap: WorkspaceBootstrap, now: number): Promise<void> {
  const bootstrapStreamIds = new Set(bootstrap.streams.map((s) => s.id))
  const bootstrapUserIds = new Set(bootstrap.users.map((u) => u.id))
  const bootstrapMembershipIds = new Set(bootstrap.streamMemberships.map((sm) => `${workspaceId}:${sm.streamId}`))
  const bootstrapDmPeerIds = new Set(bootstrap.dmPeers.map((dp) => `${workspaceId}:${dp.streamId}`))
  const bootstrapPersonaIds = new Set(bootstrap.personas.map((p) => p.id))
  const bootstrapBotIds = new Set(bootstrap.bots.map((b) => b.id))

  await Promise.all([
    deleteStale(db.streams, "workspaceId", workspaceId, bootstrapStreamIds, now),
    deleteStale(db.workspaceUsers, "workspaceId", workspaceId, bootstrapUserIds, now),
    deleteStale(db.streamMemberships, "workspaceId", workspaceId, bootstrapMembershipIds, now),
    deleteStale(db.dmPeers, "workspaceId", workspaceId, bootstrapDmPeerIds, now),
    deleteStale(db.personas, "workspaceId", workspaceId, bootstrapPersonaIds, now),
    deleteStale(db.bots, "workspaceId", workspaceId, bootstrapBotIds, now),
  ])
}

async function deleteStale(
  table: {
    where: (field: string) => {
      equals: (value: string) => { toArray: () => Promise<Array<{ id: string; _cachedAt: number }>> }
    }
    bulkDelete: (ids: string[]) => Promise<void>
  },
  scopeField: string,
  scopeValue: string,
  keepIds: Set<string>,
  now: number
): Promise<void> {
  const all = await table.where(scopeField).equals(scopeValue).toArray()
  const toDelete = all.filter((entity) => !keepIds.has(entity.id) && entity._cachedAt < now).map((e) => e.id)
  if (toDelete.length > 0) {
    await table.bulkDelete(toDelete)
  }
}
