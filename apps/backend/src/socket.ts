import type { Server } from "socket.io"
import { parseCookies } from "./lib/cookies"
import type { AuthService } from "./services/auth-service"
import type { UserService } from "./services/user-service"
import { logger } from "./lib/logger"

const SESSION_COOKIE_NAME = "wos_session"

interface Dependencies {
  authService: AuthService
  userService: UserService
}

export function registerSocketHandlers(io: Server, deps: Dependencies) {
  const { authService, userService } = deps

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
    logger.debug({ userId, socketId: socket.id }, "Socket connected")

    // =========================================================================
    // Room management
    // =========================================================================
    socket.on("join", (room: string) => {
      socket.join(room)
      logger.debug({ userId, room }, "Joined room")
    })

    socket.on("leave", (room: string) => {
      socket.leave(room)
      logger.debug({ userId, room }, "Left room")
    })

    // =========================================================================
    // Add more event handlers here...
    // =========================================================================

    socket.on("disconnect", () => {
      logger.debug({ userId, socketId: socket.id }, "Socket disconnected")
    })
  })
}
