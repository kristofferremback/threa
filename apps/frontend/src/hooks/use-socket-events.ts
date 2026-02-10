import { useEffect, useMemo, useRef } from "react"
import { useQueryClient, useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { useSocket, useSocketReconnectCount } from "@/contexts"
import { useAuth } from "@/auth"
import { db } from "@/db"
import { joinRoomWithAck } from "@/lib/socket-room"
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
} from "@threa/types"

/** Member shape from MemberRepository (includes name/email from users JOIN) */
interface MemberWithDisplay {
  id: string
  workspaceId: string
  userId: string
  role: string
  slug: string
  timezone: string | null
  locale: string | null
  name: string
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
    select: (data: WorkspaceBootstrap) => data.streamMemberships?.map((m: StreamMember) => m.streamId) ?? [],
    enabled: false, // don't refetch — just read from cache set by useWorkspaceBootstrap
  })

  // Stable serialization for dependency tracking
  const memberStreamIdsKey = useMemo(() => (memberStreamIds ?? []).sort().join(","), [memberStreamIds])

  // Join all member stream rooms so stream-scoped events (e.g. stream:activity)
  // are received for every stream the user belongs to, not just the active one.
  useEffect(() => {
    if (!socket || !workspaceId || !memberStreamIdsKey) return

    const ids = memberStreamIdsKey.split(",").filter(Boolean)
    for (const id of ids) {
      void joinRoomWithAck(socket, `ws:${workspaceId}:stream:${id}`).catch((error) => {
        console.error(`[SocketEvents] Failed to join stream room ws:${workspaceId}:stream:${id}`, error)
      })
    }

    return () => {
      for (const id of ids) {
        socket.emit("leave", `ws:${workspaceId}:stream:${id}`)
      }
    }
  }, [socket, workspaceId, memberStreamIdsKey])

  useEffect(() => {
    if (!socket || !workspaceId) return

    // Join workspace room to receive stream metadata events
    void joinRoomWithAck(socket, `ws:${workspaceId}`).catch((error) => {
      console.error(`[SocketEvents] Failed to join workspace room ws:${workspaceId}`, error)
    })

    // Handle stream created
    socket.on("stream:created", (payload: StreamPayload) => {
      // Add to workspace bootstrap cache (sidebar)
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { streams?: Stream[] }
        if (!bootstrap.streams) return old
        // Only add if not already present (avoid duplicates from own actions)
        if (bootstrap.streams.some((s) => s.id === payload.stream.id)) return old
        return {
          ...bootstrap,
          streams: [...bootstrap.streams, payload.stream],
        }
      })

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

      // Update workspace bootstrap cache (sidebar) - merge to preserve lastMessagePreview
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { streams?: Stream[] }
        if (!bootstrap.streams) return old
        return {
          ...bootstrap,
          streams: bootstrap.streams.map((s) => (s.id === payload.stream.id ? { ...s, ...payload.stream } : s)),
        }
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
                timezone: member.timezone,
                locale: member.locale,
                joinedAt: member.joinedAt,
              },
            ]

        const users = bootstrap.users || []
        const user: User = {
          id: member.userId,
          email: member.email,
          name: member.name,
          workosUserId: null,
          createdAt: member.joinedAt,
          updatedAt: member.joinedAt,
        }
        const updatedUsers = users.some((u) => u.id === member.userId) ? users : [...users, user]

        return { ...bootstrap, members: updatedMembers, users: updatedUsers }
      })

      // Cache member and user to IndexedDB
      db.workspaceMembers.put({
        id: member.id,
        workspaceId: member.workspaceId,
        userId: member.userId,
        role: member.role as "owner" | "admin" | "member",
        slug: member.slug,
        timezone: member.timezone,
        locale: member.locale,
        joinedAt: member.joinedAt,
        _cachedAt: now,
      })
      db.users.put({
        id: member.userId,
        email: member.email,
        name: member.name,
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
                timezone: member.timezone,
                locale: member.locale,
                joinedAt: member.joinedAt,
              }
            : m
        )

        const updatedUsers = bootstrap.users?.map((u) =>
          u.id === member.userId ? { ...u, name: member.name, email: member.email } : u
        )

        return { ...bootstrap, members: updatedMembers, users: updatedUsers }
      })

      // Update IndexedDB
      db.workspaceMembers.put({
        id: member.id,
        workspaceId: member.workspaceId,
        userId: member.userId,
        role: member.role as "owner" | "admin" | "member",
        slug: member.slug,
        timezone: member.timezone,
        locale: member.locale,
        joinedAt: member.joinedAt,
        _cachedAt: now,
      })
      db.users.put({
        id: member.userId,
        email: member.email,
        name: member.name,
        _cachedAt: now,
      })
    })

    // Handle stream read (from other sessions of the same user)
    socket.on("stream:read", (payload: StreamReadPayload) => {
      // Only update if it's for this workspace
      if (payload.workspaceId !== workspaceId) return

      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { unreadCounts?: Record<string, number> }
        if (!bootstrap.unreadCounts) return old
        return {
          ...bootstrap,
          unreadCounts: {
            ...bootstrap.unreadCounts,
            [payload.streamId]: 0,
          },
        }
      })
    })

    // Handle all streams read (from other sessions of the same user)
    socket.on("stream:read_all", (payload: StreamsReadAllPayload) => {
      // Only update if it's for this workspace
      if (payload.workspaceId !== workspaceId) return

      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { unreadCounts?: Record<string, number> }
        if (!bootstrap.unreadCounts) return old

        const newUnreadCounts = { ...bootstrap.unreadCounts }
        for (const streamId of payload.streamIds) {
          newUnreadCounts[streamId] = 0
        }
        return {
          ...bootstrap,
          unreadCounts: newUnreadCounts,
        }
      })
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

    return () => {
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
      socket.off("user_preferences:updated")
    }
  }, [socket, workspaceId, queryClient, user, reconnectCount])
}
