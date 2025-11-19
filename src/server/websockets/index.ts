import { Server as SocketIOServer } from "socket.io"
import type { Server as HTTPServer } from "http"
import { createAdapter } from "@socket.io/redis-adapter"
import { AuthService } from "../lib/auth-service"
import { UserService } from "../lib/user-service"
import { MessageService } from "../lib/messages"
import { parseCookies } from "../lib/cookie-utils"
import { logger } from "../lib/logger"
import type { RedisClient } from "../lib/redis"

interface SocketData {
  userId: string
  email: string
}

export const createSocketIOServer = async (
  server: HTTPServer,
  authService: AuthService,
  userService: UserService,
  messageService: MessageService,
  redisPubClient: RedisClient,
  redisSubClient: RedisClient,
) => {
  const io = new SocketIOServer<any, any, any, SocketData>(server, {
    cors: {
      origin: ["http://localhost:3000", "http://localhost:3001"],
      credentials: true,
    },
  })

  // Set up Redis adapter
  io.adapter(createAdapter(redisPubClient, redisSubClient))
  logger.info("Redis adapter connected for Socket.IO")

  // Authentication middleware
  io.use(async (socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie
    const cookies = parseCookies(cookieHeader || "")
    const sealedSession = cookies["wos_session"]

    if (!sealedSession) {
      return next(new Error("No session cookie provided"))
    }

    const result = await authService.authenticateSession(sealedSession)

    if (result.success && result.user) {
      socket.data.userId = result.user.id
      socket.data.email = result.user.email
      if (result.refreshed) {
        logger.debug({ email: result.user.email }, "Socket.IO session refreshed")
      }
      return next()
    }

    logger.warn({ reason: result.reason }, "Socket.IO auth failed")
    return next(new Error("Authentication failed"))
  })

  io.on("connection", async (socket) => {
    const userId = socket.data.userId
    const email = socket.data.email

    logger.info({ email, userId }, "Socket.IO connected")

    // Ensure user exists and get default channel
    await userService.ensureUser({
      id: userId,
      email,
      firstName: null,
      lastName: null,
    })

    const channelId = await userService.getDefaultChannel()

    // Load recent messages
    const messagesWithAuthors = await messageService.getMessagesWithAuthors(channelId, 50)
    socket.emit("messages", messagesWithAuthors)
    socket.emit("connected", { message: "Connected to Threa", channelId })

    // Handle incoming messages
    socket.on("message", async (data: { message: string }) => {
      try {
        const message = await messageService.createMessage({
          channelId,
          authorId: userId,
          content: data.message,
        })

        io.emit("message", {
          id: message.id,
          userId,
          email,
          message: data.message,
          timestamp: message.created_at.toISOString(),
        })
      } catch (error) {
        logger.error({ err: error }, "Failed to process message")
        socket.emit("error", { message: "Failed to send message" })
      }
    })

    socket.on("disconnect", () => {
      logger.info({ email }, "Socket.IO disconnected")
    })
  })

  return io
}
