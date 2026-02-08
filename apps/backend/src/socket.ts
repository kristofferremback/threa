import type { Server, Socket } from "socket.io"
import { parseCookies } from "./lib/cookies"
import type { AuthService } from "./auth/auth-service"
import type { UserService } from "./auth/user-service"
import type { StreamService } from "./services/stream-service"
import type { WorkspaceService } from "./services/workspace-service"
import type { UserSocketRegistry } from "./lib/user-socket-registry"
import { AgentSessionRepository } from "./repositories/agent-session-repository"
import { MemberRepository } from "./repositories/member-repository"
import { logger } from "./lib/logger"
import { wsConnectionsActive, wsConnectionDuration, wsMessagesTotal } from "./lib/metrics"

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
}

/**
 * Extract workspaceId from room string.
 */
function extractWorkspaceId(room: string): string {
  const match = room.match(/^ws:([^:]+)/)
  return match ? match[1] : "-"
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
  userService: UserService
  streamService: StreamService
  workspaceService: WorkspaceService
  userSocketRegistry: UserSocketRegistry
}

export function registerSocketHandlers(io: Server, deps: Dependencies) {
  const { pool, authService, userService, streamService, workspaceService, userSocketRegistry } = deps

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

    const user = await userService.getUserByWorkosUserId(result.user.id)
    if (!user) {
      return next(new Error("User not found"))
    }

    socket.data.userId = user.id
    return next()
  })

  // ===========================================================================
  // Connection handlers
  // ===========================================================================
  io.on("connection", (socket) => {
    const userId = socket.data.userId
    userSocketRegistry.register(userId, socket)
    logger.debug({ userId, socketId: socket.id }, "Socket connected")

    // Initialize metrics state for this socket
    const metricsState: SocketMetricsState = {
      connectTime: process.hrtime.bigint(),
      joinedRooms: new Map(),
    }

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
        const isMember = await workspaceService.isMember(wsId, userId)
        if (!isMember) {
          const message = "Not authorized to join this workspace"
          socket.emit("error", { message })
          wsMessagesTotal.inc({ workspace_id: wsId, direction: "sent", event_type: "error", room_pattern: roomPattern })
          callback?.({ ok: false, error: message })
          return
        }
        socket.join(room)
        callback?.({ ok: true })

        // Track metrics
        wsConnectionsActive.inc({ workspace_id: wsId, room_pattern: roomPattern })
        metricsState.joinedRooms.set(room, { workspaceId: wsId, roomPattern })

        logger.debug({ userId, room }, "Joined workspace room")
        return
      }

      // Stream room: ws:${workspaceId}:stream:${streamId}
      const streamMatch = room.match(/^ws:([^:]+):stream:(.+)$/)
      if (streamMatch) {
        const [, wsId, streamId] = streamMatch
        // Resolve user → member for stream membership check
        const member = await MemberRepository.findByUserIdInWorkspace(pool, wsId, userId)
        if (!member || !(await streamService.isMember(streamId, member.id))) {
          const message = "Not authorized to join this stream"
          socket.emit("error", { message })
          wsMessagesTotal.inc({ workspace_id: wsId, direction: "sent", event_type: "error", room_pattern: roomPattern })
          callback?.({ ok: false, error: message })
          return
        }
        socket.join(room)
        callback?.({ ok: true })

        // Track metrics
        wsConnectionsActive.inc({ workspace_id: wsId, room_pattern: roomPattern })
        metricsState.joinedRooms.set(room, { workspaceId: wsId, roomPattern })

        logger.debug({ userId, room }, "Joined stream room")
        return
      }

      // Agent session room: ws:${workspaceId}:agent_session:${sessionId}
      const sessionMatch = room.match(/^ws:([^:]+):agent_session:(.+)$/)
      if (sessionMatch) {
        const [, wsId, agentSessionId] = sessionMatch
        // Verify user has access to the session's stream
        const session = await AgentSessionRepository.findById(pool, agentSessionId)
        if (!session) {
          const message = "Session not found"
          socket.emit("error", { message })
          wsMessagesTotal.inc({ workspace_id: wsId, direction: "sent", event_type: "error", room_pattern: roomPattern })
          callback?.({ ok: false, error: message })
          return
        }
        // Resolve user → member for stream membership check
        const member = await MemberRepository.findByUserIdInWorkspace(pool, wsId, userId)
        if (!member || !(await streamService.isMember(session.streamId, member.id))) {
          const message = "Not authorized to join this session"
          socket.emit("error", { message })
          wsMessagesTotal.inc({ workspace_id: wsId, direction: "sent", event_type: "error", room_pattern: roomPattern })
          callback?.({ ok: false, error: message })
          return
        }
        socket.join(room)
        callback?.({ ok: true })
        wsConnectionsActive.inc({ workspace_id: wsId, room_pattern: roomPattern })
        metricsState.joinedRooms.set(room, { workspaceId: wsId, roomPattern })
        logger.debug({ userId, room }, "Joined agent session room")
        return
      }

      // Unknown room format
      const message = "Invalid room format"
      socket.emit("error", { message })
      wsMessagesTotal.inc({
        workspace_id: workspaceId,
        direction: "sent",
        event_type: "error",
        room_pattern: roomPattern,
      })
      callback?.({ ok: false, error: message })
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

      // Track metrics
      const roomInfo = metricsState.joinedRooms.get(room)
      if (roomInfo) {
        wsConnectionsActive.dec({ workspace_id: roomInfo.workspaceId, room_pattern: roomInfo.roomPattern })
        metricsState.joinedRooms.delete(room)
      }

      logger.debug({ userId, room }, "Left room")
    })

    // =========================================================================
    // Add more event handlers here...
    // =========================================================================

    socket.on("disconnect", () => {
      userSocketRegistry.unregister(userId, socket)

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
      logger.debug({ userId, socketId: socket.id }, "Socket disconnected")
    })
  })
}
