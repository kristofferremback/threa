import type { Server, Socket } from "socket.io"
import { parseCookies } from "./lib/cookies"
import type { AuthService } from "./auth/auth-service"
import type { StreamService } from "./features/streams"
import type { UserSocketRegistry } from "./lib/user-socket-registry"
import { AgentSessionRepository } from "./features/agents"
import { UserRepository } from "./features/workspaces"
import { HttpError } from "./lib/errors"
import { logger } from "./lib/logger"
import { wsConnectionsActive, wsConnectionDuration, wsMessagesTotal } from "./lib/observability"

const SESSION_COOKIE_NAME = "wos_session"

/**
 * Normalize room to pattern for metrics.
 * Replaces IDs with placeholders section-by-section:
 * - ws:abc123 -> ws:{workspaceId}
 * - ws:abc123:stream:xyz789 -> ws:{workspaceId}:stream:{streamId}
 * - ws:abc123:stream:xyz789:thread:def456 -> ws:{workspaceId}:stream:{streamId}:thread:{threadId}
 */
function normalizeRoomPattern(room: string): string {
  return room
    .replace(/^ws:[\w]+/, "ws:{workspaceId}")
    .replace(/stream:[\w]+/, "stream:{streamId}")
    .replace(/thread:[\w]+/, "thread:{threadId}")
    .replace(/agent_session:[\w]+/, "agent_session:{sessionId}")
    .replace(/member:[\w]+/, "member:{memberId}")
}

/**
 * Extract workspaceId from room string.
 */
function extractWorkspaceId(room: string): string {
  const match = room.match(/^ws:([^:]+)/)
  return match ? match[1] : "-"
}

function isJoinAccessError(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 403 || error.status === 404)
}

/**
 * Track per-socket state for metrics.
 */
interface SocketMetricsState {
  connectTime: bigint
  joinedRooms: Map<string, { workspaceId: string; roomPattern: string }>
}

interface Dependencies {
  pool: import("pg").Pool
  authService: AuthService
  streamService: StreamService
  userSocketRegistry: UserSocketRegistry
}

export function registerSocketHandlers(io: Server, deps: Dependencies) {
  const { pool, authService, streamService, userSocketRegistry } = deps

  // ===========================================================================
  // Authentication middleware
  // ===========================================================================
  io.use(async (socket, next) => {
    const cookies = parseCookies(socket.handshake.headers.cookie || "")
    const session = cookies[SESSION_COOKIE_NAME]

    if (!session) {
      return next(new Error("No session cookie"))
    }

    const result = await authService.authenticateSession(session)
    if (!result.success || !result.user) {
      return next(new Error("Authentication failed"))
    }

    socket.data.workosUserId = result.user.id
    return next()
  })

  // ===========================================================================
  // Connection handlers
  // ===========================================================================
  io.on("connection", (socket) => {
    const workosUserId = socket.data.workosUserId
    userSocketRegistry.register(workosUserId, socket)
    logger.debug({ workosUserId, socketId: socket.id }, "Socket connected")

    // Initialize metrics state for this socket
    const metricsState: SocketMetricsState = {
      connectTime: process.hrtime.bigint(),
      joinedRooms: new Map(),
    }

    // Track member rooms per workspace for auto-leave on workspace leave
    const memberRooms = new Map<string, { memberId: string; memberRoom: string }>()

    // =========================================================================
    // Room management
    // =========================================================================
    socket.on("join", async (room: string, callback?: (result: { ok: boolean; error?: string }) => void) => {
      const workspaceId = extractWorkspaceId(room)
      const roomPattern = normalizeRoomPattern(room)
      wsMessagesTotal.inc({
        workspace_id: workspaceId,
        direction: "received",
        event_type: "join",
        room_pattern: roomPattern,
      })

      // Workspace room: ws:${workspaceId}
      const workspaceMatch = room.match(/^ws:([^:]+)$/)
      if (workspaceMatch) {
        const wsId = workspaceMatch[1]
        const member = await UserRepository.findByWorkosUserIdInWorkspace(pool, wsId, workosUserId)
        if (!member) {
          socket.emit("error", { message: "Not authorized to join this workspace" })
          wsMessagesTotal.inc({ workspace_id: wsId, direction: "sent", event_type: "error", room_pattern: roomPattern })
          callback?.({ ok: false, error: "Not authorized to join this workspace" })
          return
        }
        socket.join(room)

        // Auto-join member room for targeted event delivery (activity, commands, read state)
        const memberRoom = `ws:${wsId}:member:${member.id}`
        socket.join(memberRoom)
        memberRooms.set(wsId, { memberId: member.id, memberRoom })

        // Track metrics
        wsConnectionsActive.inc({ workspace_id: wsId, room_pattern: roomPattern })
        metricsState.joinedRooms.set(room, { workspaceId: wsId, roomPattern })

        logger.debug({ workosUserId, room, memberRoom }, "Joined workspace room")
        callback?.({ ok: true })
        return
      }

      // Stream room: ws:${workspaceId}:stream:${streamId}
      const streamMatch = room.match(/^ws:([^:]+):stream:(.+)$/)
      if (streamMatch) {
        const [, wsId, streamId] = streamMatch
        // Resolve user -> member for stream access validation
        const member = await UserRepository.findByWorkosUserIdInWorkspace(pool, wsId, workosUserId)
        if (!member) {
          socket.emit("error", { message: "Not authorized to join this stream" })
          wsMessagesTotal.inc({ workspace_id: wsId, direction: "sent", event_type: "error", room_pattern: roomPattern })
          callback?.({ ok: false, error: "Not authorized to join this stream" })
          return
        }
        try {
          await streamService.validateStreamAccess(streamId, wsId, member.id)
        } catch (error) {
          if (!isJoinAccessError(error)) {
            logger.error({ error, workosUserId, room, wsId, streamId }, "Unexpected error during stream room join")
          }
          socket.emit("error", { message: "Not authorized to join this stream" })
          wsMessagesTotal.inc({ workspace_id: wsId, direction: "sent", event_type: "error", room_pattern: roomPattern })
          callback?.({ ok: false, error: "Not authorized to join this stream" })
          return
        }
        socket.join(room)

        // Track metrics
        wsConnectionsActive.inc({ workspace_id: wsId, room_pattern: roomPattern })
        metricsState.joinedRooms.set(room, { workspaceId: wsId, roomPattern })

        logger.debug({ workosUserId, room }, "Joined stream room")
        callback?.({ ok: true })
        return
      }

      // Agent session room: ws:${workspaceId}:agent_session:${sessionId}
      const sessionMatch = room.match(/^ws:([^:]+):agent_session:(.+)$/)
      if (sessionMatch) {
        const [, wsId, agentSessionId] = sessionMatch
        // Verify user has access to the session's stream
        const session = await AgentSessionRepository.findById(pool, agentSessionId)
        if (!session) {
          socket.emit("error", { message: "Session not found" })
          wsMessagesTotal.inc({ workspace_id: wsId, direction: "sent", event_type: "error", room_pattern: roomPattern })
          callback?.({ ok: false, error: "Session not found" })
          return
        }
        // Resolve user -> member for stream access validation
        const member = await UserRepository.findByWorkosUserIdInWorkspace(pool, wsId, workosUserId)
        if (!member) {
          socket.emit("error", { message: "Not authorized to join this session" })
          wsMessagesTotal.inc({ workspace_id: wsId, direction: "sent", event_type: "error", room_pattern: roomPattern })
          callback?.({ ok: false, error: "Not authorized to join this session" })
          return
        }
        try {
          await streamService.validateStreamAccess(session.streamId, wsId, member.id)
        } catch (error) {
          if (!isJoinAccessError(error)) {
            logger.error(
              { error, workosUserId, room, wsId, streamId: session.streamId },
              "Unexpected error during agent session room join"
            )
          }
          socket.emit("error", { message: "Not authorized to join this session" })
          wsMessagesTotal.inc({ workspace_id: wsId, direction: "sent", event_type: "error", room_pattern: roomPattern })
          callback?.({ ok: false, error: "Not authorized to join this session" })
          return
        }
        socket.join(room)
        wsConnectionsActive.inc({ workspace_id: wsId, room_pattern: roomPattern })
        metricsState.joinedRooms.set(room, { workspaceId: wsId, roomPattern })
        logger.debug({ workosUserId, room }, "Joined agent session room")
        callback?.({ ok: true })
        return
      }

      // Unknown room format
      socket.emit("error", { message: "Invalid room format" })
      wsMessagesTotal.inc({
        workspace_id: workspaceId,
        direction: "sent",
        event_type: "error",
        room_pattern: roomPattern,
      })
      callback?.({ ok: false, error: "Invalid room format" })
    })

    socket.on("leave", (room: string) => {
      const workspaceId = extractWorkspaceId(room)
      const roomPattern = normalizeRoomPattern(room)
      wsMessagesTotal.inc({
        workspace_id: workspaceId,
        direction: "received",
        event_type: "leave",
        room_pattern: roomPattern,
      })

      socket.leave(room)

      // Auto-leave member room when leaving a workspace room
      const wsMatch = room.match(/^ws:([^:]+)$/)
      if (wsMatch) {
        const wsId = wsMatch[1]
        const entry = memberRooms.get(wsId)
        if (entry) {
          socket.leave(entry.memberRoom)
          memberRooms.delete(wsId)
        }
      }

      // Track metrics
      const roomInfo = metricsState.joinedRooms.get(room)
      if (roomInfo) {
        wsConnectionsActive.dec({ workspace_id: roomInfo.workspaceId, room_pattern: roomInfo.roomPattern })
        metricsState.joinedRooms.delete(room)
      }

      logger.debug({ workosUserId, room }, "Left room")
    })

    // =========================================================================
    // Add more event handlers here...
    // =========================================================================

    socket.on("disconnect", () => {
      userSocketRegistry.unregister(workosUserId, socket)

      // Clean up metrics for all joined rooms
      const connectionDurationSeconds = Number(process.hrtime.bigint() - metricsState.connectTime) / 1e9
      const workspaceIds = new Set<string>()

      for (const [, roomInfo] of metricsState.joinedRooms) {
        wsConnectionsActive.dec({ workspace_id: roomInfo.workspaceId, room_pattern: roomInfo.roomPattern })
        workspaceIds.add(roomInfo.workspaceId)
      }

      // Observe duration per unique workspace
      for (const workspaceId of workspaceIds) {
        wsConnectionDuration.observe({ workspace_id: workspaceId }, connectionDurationSeconds)
      }

      metricsState.joinedRooms.clear()
      logger.debug({ workosUserId, socketId: socket.id }, "Socket disconnected")
    })
  })
}
