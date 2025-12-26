import type { Server } from "socket.io"
import { parseCookies } from "./lib/cookies"
import type { AuthService } from "./services/auth-service"
import type { UserService } from "./services/user-service"
import type { StreamService } from "./services/stream-service"
import type { WorkspaceService } from "./services/workspace-service"
import type { UserSocketRegistry } from "./lib/user-socket-registry"
import { logger } from "./lib/logger"

const SESSION_COOKIE_NAME = "wos_session"

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

    // =========================================================================
    // Room management
    // =========================================================================
    socket.on("join", async (room: string) => {
      // Workspace room: ws:${workspaceId}
      const workspaceMatch = room.match(/^ws:([^:]+)$/)
      if (workspaceMatch) {
        const workspaceId = workspaceMatch[1]
        const isMember = await workspaceService.isMember(workspaceId, userId)
        if (!isMember) {
          socket.emit("error", { message: "Not authorized to join this workspace" })
          return
        }
        socket.join(room)
        logger.debug({ userId, room }, "Joined workspace room")
        return
      }

      // Stream room: ws:${workspaceId}:stream:${streamId}
      const streamMatch = room.match(/^ws:([^:]+):stream:(.+)$/)
      if (streamMatch) {
        const [, , streamId] = streamMatch
        const isMember = await streamService.isMember(streamId, userId)
        if (!isMember) {
          socket.emit("error", { message: "Not authorized to join this stream" })
          return
        }
        socket.join(room)
        logger.debug({ userId, room }, "Joined stream room")
        return
      }

      // Legacy stream room format: stream:${streamId}
      const legacyStreamMatch = room.match(/^stream:(.+)$/)
      if (legacyStreamMatch) {
        const streamId = legacyStreamMatch[1]
        const isMember = await streamService.isMember(streamId, userId)
        if (!isMember) {
          socket.emit("error", { message: "Not authorized to join this stream" })
          return
        }
        socket.join(room)
        logger.debug({ userId, room }, "Joined stream room (legacy)")
        return
      }

      // Unknown room format
      socket.emit("error", { message: "Invalid room format" })
    })

    socket.on("leave", (room: string) => {
      socket.leave(room)
      logger.debug({ userId, room }, "Left room")
    })

    // =========================================================================
    // Add more event handlers here...
    // =========================================================================

    socket.on("disconnect", () => {
      userSocketRegistry.unregister(userId, socket)
      logger.debug({ userId, socketId: socket.id }, "Socket disconnected")
    })
  })
}
