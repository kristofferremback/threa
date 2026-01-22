import type { Server, Socket } from "socket.io"
import { parseCookies } from "./lib/cookies"
import type { AuthService } from "./services/auth-service"
import type { UserService } from "./services/user-service"
import type { StreamService } from "./services/stream-service"
import type { WorkspaceService } from "./services/workspace-service"
import type { UserSocketRegistry } from "./lib/user-socket-registry"
import { logger } from "./lib/logger"
import { wsConnectionsActive, wsConnectionDuration, wsMessagesTotal } from "./lib/metrics"

const SESSION_COOKIE_NAME = "wos_session"

/**
 * Normalize room to pattern for metrics.
 * - ws:abc123 -> ws:{workspaceId}
 * - ws:abc123:stream:xyz789 -> ws:{workspaceId}:stream:{streamId}
 */
function normalizeRoomPattern(room: string): string {
  if (room.match(/^ws:[^:]+:stream:.+$/)) {
    return "ws:{workspaceId}:stream:{streamId}"
  }
  if (room.match(/^ws:[^:]+$/)) {
    return "ws:{workspaceId}"
  }
  return "unknown"
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
  authService: AuthService
  userService: UserService
  streamService: StreamService
  workspaceService: WorkspaceService
  userSocketRegistry: UserSocketRegistry
}

export function registerSocketHandlers(io: Server, deps: Dependencies) {
  const { authService, userService, streamService, workspaceService, userSocketRegistry } = deps

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
    socket.on("join", async (room: string) => {
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
          socket.emit("error", { message: "Not authorized to join this workspace" })
          wsMessagesTotal.inc({ workspace_id: wsId, direction: "sent", event_type: "error", room_pattern: roomPattern })
          return
        }
        socket.join(room)

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
        const isMember = await streamService.isMember(streamId, userId)
        if (!isMember) {
          socket.emit("error", { message: "Not authorized to join this stream" })
          wsMessagesTotal.inc({ workspace_id: wsId, direction: "sent", event_type: "error", room_pattern: roomPattern })
          return
        }
        socket.join(room)

        // Track metrics
        wsConnectionsActive.inc({ workspace_id: wsId, room_pattern: roomPattern })
        metricsState.joinedRooms.set(room, { workspaceId: wsId, roomPattern })

        logger.debug({ userId, room }, "Joined stream room")
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
